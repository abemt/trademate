import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg(props: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </Svg>
);

export const IconCrosshair = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </Svg>
);

export const IconChat = (p: P) => (
  <Svg {...p}>
    <path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 4V6Z" />
    <path d="M8.5 8.5h7M8.5 12h4" />
  </Svg>
);

export const IconJournal = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);

export const IconStats = (p: P) => (
  <Svg {...p}>
    <path d="M5 20v-6M11 20V6M17 20v-9" />
    <path d="M3 20h18" />
  </Svg>
);

export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const IconCoin = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
  </Svg>
);

export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </Svg>
);

export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
    <path d="M9.5 12l2 2 3.5-4" />
  </Svg>
);

export const IconNews = (p: P) => (
  <Svg {...p}>
    <path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V5Z" />
    <path d="M17 9h3v10a2 2 0 0 1-2 2" />
    <path d="M7.5 9h6M7.5 13h6M7.5 17h4" />
  </Svg>
);

export const IconGauge = (p: P) => (
  <Svg {...p}>
    <path d="M5 19a8.5 8.5 0 1 1 14 0" />
    <path d="M12 15l3.5-5" />
    <circle cx="12" cy="15" r="1.4" />
  </Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13" />
    <path d="M10 11v5M14 11v5" />
  </Svg>
);

export const IconTrendUp = (p: P) => (
  <Svg {...p}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Svg>
);

export const IconTrendDown = (p: P) => (
  <Svg {...p}>
    <path d="M3 7l6 6 4-4 8 8" />
    <path d="M15 17h6v-6" />
  </Svg>
);

export const IconCandles = (p: P) => (
  <Svg {...p}>
    <path d="M7 4v3M7 17v3M17 2.5v3M17 15v3" />
    <rect x="5" y="7" width="4" height="10" rx="1" />
    <rect x="15" y="5.5" width="4" height="9.5" rx="1" />
  </Svg>
);

export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M5.2 18.8l2-2M16.8 7.2l2-2" />
  </Svg>
);

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
  </Svg>
);

export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
  </Svg>
);

export const IconSpark = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M13 2 4.5 14H10l-1 8 8.5-12H12l1-8Z" />
  </svg>
);
