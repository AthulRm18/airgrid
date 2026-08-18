"""
Forecasting: predicts each H3 cell's PM2.5 trajectory for the next few
hours, so the dashboard can show "this cell is trending toward unhealthy"
before a sensor or citizen report confirms it — the RECOMMEND step's
forward-looking half.

Deliberately a simple model (LightGBM on lag + time-of-day features) —
for a week-long build, a model you can explain end-to-end in the demo
beats a fancier one you can't. The judging rubric weights "is Google AI
doing meaningful work end-to-end", not novelty of the forecasting method.
"""
import pandas as pd
import lightgbm as lgb
from sklearn.model_selection import train_test_split

FEATURE_COLUMNS = [
    "pm25_lag_1h", "pm25_lag_3h", "pm25_lag_24h",
    "hour_of_day", "day_of_week", "is_weekend",
]

_MODEL: lgb.LGBMRegressor | None = None  # trained once, cached in-process


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """df: columns h3_cell, timestamp, pm25 — one row per cell per hour."""
    df = df.sort_values(["h3_cell", "timestamp"]).copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    for lag, name in [(1, "pm25_lag_1h"), (3, "pm25_lag_3h"), (24, "pm25_lag_24h")]:
        df[name] = df.groupby("h3_cell")["pm25"].shift(lag)

    df["hour_of_day"] = df["timestamp"].dt.hour
    df["day_of_week"] = df["timestamp"].dt.dayofweek
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

    return df


def train(historical_df: pd.DataFrame) -> dict:
    """Trains and caches the model in-process. Returns a small metrics dict
    so the /api/forecast/train endpoint has something to report."""
    global _MODEL
    df = build_features(historical_df).dropna(subset=FEATURE_COLUMNS)

    X, y = df[FEATURE_COLUMNS], df["pm25"]
    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.15, shuffle=False)

    model = lgb.LGBMRegressor(
        n_estimators=300, learning_rate=0.04, max_depth=5,
        min_child_samples=10, verbose=-1,
    )
    model.fit(
        X_train, y_train,
        eval_X=X_val, eval_y=y_val,
        callbacks=[lgb.early_stopping(stopping_rounds=25, verbose=False)],
    )
    _MODEL = model

    val_pred = model.predict(X_val)
    mae = float((val_pred - y_val).abs().mean())
    return {"trained_on_rows": len(X_train), "validation_mae": round(mae, 2)}


def is_trained() -> bool:
    return _MODEL is not None


def forecast_cell(historical_df: pd.DataFrame, h3_cell: str, hours_ahead: int = 24) -> list[dict]:
    """
    Autoregressive multi-step forecast: predict hour+1, feed that back in
    as the new lag_1h, predict hour+2, and so on. Simple, and honest about
    uncertainty compounding over the horizon (which is why the dashboard
    should treat far-future points as directional, not precise).
    """
    if _MODEL is None:
        raise RuntimeError("model not trained yet — call train() first")

    cell_history = historical_df[historical_df["h3_cell"] == h3_cell].sort_values("timestamp")
    if cell_history.empty:
        raise ValueError(f"no history for cell {h3_cell}")

    recent = cell_history.tail(24).copy()
    last_timestamp = recent["timestamp"].max()
    pm25_series = list(recent["pm25"])

    predictions = []
    for step in range(1, hours_ahead + 1):
        next_ts = last_timestamp + pd.Timedelta(hours=step)
        feat = pd.DataFrame([{
            "pm25_lag_1h": pm25_series[-1],
            "pm25_lag_3h": pm25_series[-3] if len(pm25_series) >= 3 else pm25_series[-1],
            "pm25_lag_24h": pm25_series[-24] if len(pm25_series) >= 24 else pm25_series[0],
            "hour_of_day": next_ts.hour,
            "day_of_week": next_ts.dayofweek,
            "is_weekend": int(next_ts.dayofweek >= 5),
        }])
        pred = float(_MODEL.predict(feat[FEATURE_COLUMNS])[0])
        pm25_series.append(pred)
        predictions.append({"timestamp": next_ts.isoformat(), "predicted_pm25": round(pred, 1)})

    return predictions
