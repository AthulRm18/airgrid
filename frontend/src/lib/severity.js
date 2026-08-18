// Single source of truth for severity -> color/label, so the map legend,
// hex fills, and alert badges can never drift out of sync with each other.
export const SEVERITY = {
  confirmed: {
    label: "Confirmed",
    color: "var(--color-sev-confirmed)",
    description: "Ground sensor reading itself is unhealthy.",
  },
  corroborated: {
    label: "Corroborated",
    color: "var(--color-sev-corroborated)",
    description: "Citizen + satellite signals agree, sensor nearby confirms.",
  },
  hidden: {
    label: "Hidden hotspot",
    color: "var(--color-sev-hidden)",
    description: "No sensor covers this cell — caught only by citizen + satellite fusion.",
  },
  unverified: {
    label: "Unverified",
    color: "var(--color-sev-unverified)",
    description: "Single weak signal, awaiting corroboration.",
  },
};

export const SEVERITY_ORDER = ["hidden", "confirmed", "corroborated", "unverified"];
