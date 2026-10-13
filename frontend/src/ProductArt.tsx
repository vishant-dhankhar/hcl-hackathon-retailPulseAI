import {
  Headphones,
  Laptop,
  Smartphone,
  Watch,
  Coffee,
  Speaker,
  Mouse,
  Keyboard,
  Refrigerator,
  LampDesk,
  Wind,
} from 'lucide-react';
// Local vector illustrations keep the demo independent of external image hosts.
export function ProductArt({
  name,
  color = 'sage',
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  const icon = name.includes('headphones')
    ? Headphones
    : name.includes('speaker')
      ? Speaker
      : name.includes('laptop')
        ? Laptop
        : name.includes('mouse')
          ? Mouse
          : name.includes('keyboard')
            ? Keyboard
            : name.includes('smartphone')
              ? Smartphone
              : name.includes('watch') || name.includes('band')
                ? Watch
                : name.includes('coffee')
                  ? Coffee
                  : name.includes('refrigerator')
                    ? Refrigerator
                    : name.includes('lamp')
                      ? LampDesk
                      : Wind;
  const Icon = icon;
  return (
    <div className={`product-art ${color} ${small ? 'small' : ''}`} role="img" aria-label={name}>
      <span className="art-circle" />
      <Icon strokeWidth={1.15} />
      <span className="art-shadow" />
    </div>
  );
}
