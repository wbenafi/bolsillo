import Image from "next/image";

type BrandIconProps = Readonly<{
  className?: string;
  priority?: boolean;
}>;

export function BrandIcon({ className = "", priority = false }: BrandIconProps) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={`brand-icon ${className}`.trim()}
      height={600}
      priority={priority}
      sizes="92px"
      src="/brand-icon.png"
      width={600}
    />
  );
}
