/** Custom VIGIL mark — hex grid + air-quality wave, not a generic shield icon */
export default function VigilLogo({ size = 28, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="url(#vigil-bg)" />
      {/* H3 hex cell */}
      <path
        d="M16 6 L23 10 V18 L16 22 L9 18 V10 Z"
        stroke="#fff"
        strokeWidth="1.2"
        fill="rgba(255,255,255,0.12)"
      />
      {/* Inner hex — hotspot */}
      <path
        d="M16 10 L20 12.5 V17.5 L16 20 L12 17.5 V12.5 Z"
        fill="#fff"
        fillOpacity="0.9"
      />
      {/* Air wave */}
      <path
        d="M8 26 Q12 23 16 26 T24 26"
        stroke="#7ec8ff"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <defs>
        <linearGradient id="vigil-bg" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#1a73e8" />
          <stop offset="1" stopColor="#0d5bbf" />
        </linearGradient>
      </defs>
    </svg>
  );
}
