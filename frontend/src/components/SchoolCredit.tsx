
const SCHOOL_CREDIT_TEXT =
  "Developed in Information and Communication Technology High School";

function SchoolCredit() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 px-4 py-2 text-center font-serif text-xs font-medium tracking-[0.03em] text-warn/90">
      {SCHOOL_CREDIT_TEXT}
    </div>
  );
}

export default SchoolCredit;
