export const BRAND_NAME = "I-PAROL SYNAPSE";
export const BRAND_CATEGORY = "2026 · AI-Powered Lighting Studio";
export const BRAND_TAGLINE = "Where Intelligence Meets Illumination";
export const BRAND_SUBTAGLINE = "Create. Connect. Illuminate.";

// Compact wordmark used in headers and sign-in screens.
export default function Brand({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex items-center gap-2 text-sm font-semibold tracking-[0.04em] text-fg ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-pine-soft" />
      {BRAND_NAME}
    </p>
  );
}
