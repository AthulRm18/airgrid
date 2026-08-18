// Single source of truth for severity -> color/label, so the map legend,
// hex fills, and alert badges can never drift out of sync with each other.
//
// rawColor is the hex value for Leaflet (which doesn't understand CSS vars).
// color is the CSS variable reference for non-Leaflet components.
export const SEVERITY = {
  confirmed: {
    label: "Confirmed",
    color: "var(--color-sev-confirmed)",
    rawColor: "#e0524a",
    description: "Ground sensor reading itself is unhealthy.",
  },
  corroborated: {
    label: "Corroborated",
    color: "var(--color-sev-corroborated)",
    rawColor: "#e8a23d",
    description: "Citizen + satellite signals agree, sensor nearby confirms.",
  },
  hidden: {
    label: "Hidden hotspot",
    color: "var(--color-sev-hidden)",
    rawColor: "#a870e8",
    description: "No sensor covers this cell — caught only by citizen + satellite fusion.",
  },
  unverified: {
    label: "Unverified",
    color: "var(--color-sev-unverified)",
    rawColor: "#4a5568",
    description: "Single weak signal, awaiting corroboration.",
  },
};

export const SEVERITY_ORDER = ["hidden", "confirmed", "corroborated", "unverified"];
