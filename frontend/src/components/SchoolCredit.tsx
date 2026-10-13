
const SCHOOL_CREDIT_TEXT =
  "Developed in Information and Communication Technology High School";

function SchoolCredit() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050505]/85 px-4 py-2 text-center text-[10px] uppercase tracking-[0.3em] text-white/40 backdrop-blur">
      {SCHOOL_CREDIT_TEXT}
    </div>
  );
}

export default SchoolCredit;
