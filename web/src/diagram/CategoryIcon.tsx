/**
 * A glyph per category, so a kind is never carried by colour alone (FR-10).
 * Drawn rather than loaded: no image requests, and no icon set to license,
 * ship and keep in step with the catalog.
 */

type CategoryIconProps = {
  category: string;
  size?: number;
};

export function CategoryIcon({ category, size = 16 }: CategoryIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    // Decorative: the category is written beside it, and "network icon,
    // network" helps nobody.
    'aria-hidden': true,
    focusable: false,
  };

  switch (category) {
    case 'network':
      return (
        <svg {...common}>
          <rect x="1.5" y="3" width="13" height="10" rx="2" />
          <path d="M1.5 7h13" />
        </svg>
      );
    case 'compute':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="10" height="10" rx="1.5" />
          <path d="M6 1.5v1.5M10 1.5v1.5M6 13v1.5M10 13v1.5M1.5 6H3M1.5 10H3M13 6h1.5M13 10h1.5" />
        </svg>
      );
    case 'storage':
      return (
        <svg {...common}>
          <path d="M2 4.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5-6-1.1-6-2.5Z" />
          <path d="M2 4.5v7c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-7" />
        </svg>
      );
    case 'database':
      return (
        <svg {...common}>
          <ellipse cx="8" cy="4" rx="5.5" ry="2.2" />
          <path d="M2.5 4v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" />
        </svg>
      );
    case 'loadbalancer':
      return (
        <svg {...common}>
          <path d="M8 2v4M8 6 3 10M8 6l5 4" />
          <circle cx="8" cy="2" r="1.2" />
          <circle cx="3" cy="11.5" r="1.5" />
          <circle cx="13" cy="11.5" r="1.5" />
        </svg>
      );
    case 'serverless':
      return (
        <svg {...common}>
          <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" />
        </svg>
      );
    case 'identity':
      return (
        <svg {...common}>
          <circle cx="8" cy="5.5" r="2.8" />
          <path d="M2.8 14c.6-2.8 2.7-4.2 5.2-4.2s4.6 1.4 5.2 4.2" />
        </svg>
      );
    case 'container':
      return (
        <svg {...common}>
          <rect x="2" y="8.5" width="4" height="4" rx="0.6" />
          <rect x="6.5" y="8.5" width="4" height="4" rx="0.6" />
          <rect x="4.25" y="4" width="4" height="4" rx="0.6" />
        </svg>
      );
    case 'observability':
      return (
        <svg {...common}>
          <path d="M1.5 9.5 5 6l3 3 2.5-4 3.5 5.5" />
        </svg>
      );
    case 'security':
      return (
        <svg {...common}>
          <path d="M8 1.5 13.5 4v4.2c0 3-2.3 5.3-5.5 6.3-3.2-1-5.5-3.3-5.5-6.3V4L8 1.5Z" />
        </svg>
      );
    case 'provider':
      return (
        <svg {...common}>
          <path d="M4.5 12.5a3.5 3.5 0 0 1-.3-7 4.7 4.7 0 0 1 9 1.2 2.9 2.9 0 0 1-.7 5.8H4.5Z" />
        </svg>
      );
    case 'region':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.2" />
          <path d="M1.8 8h12.4M8 1.8c1.7 2 2.6 4 2.6 6.2s-.9 4.2-2.6 6.2c-1.7-2-2.6-4-2.6-6.2S6.3 3.8 8 1.8Z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" strokeDasharray="2.5 2" />
        </svg>
      );
  }
}
