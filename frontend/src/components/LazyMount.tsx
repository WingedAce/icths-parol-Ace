import { useEffect, useRef, useState, type ReactNode } from "react";

// Draws its children only once it is near the screen. Used by the Gallery so
// opening it doesn't draw (and decode the drawing for) every keyframe at once.
// Once drawn it stays drawn, so scrolling back doesn't flicker.
export default function LazyMount({
  children,
  placeholderHeight = 140,
  className,
}: {
  children: ReactNode;
  placeholderHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <div
      ref={ref}
      className={className}
      style={seen ? undefined : { minHeight: placeholderHeight }}
    >
      {seen ? children : null}
    </div>
  );
}
