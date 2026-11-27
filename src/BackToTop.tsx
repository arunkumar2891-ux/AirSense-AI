import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import { backToTopVisible, scrollTopBehavior } from "./sections";

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(backToTopVisible(window.scrollY));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!visible) return null;

  return <button
    type="button"
    className="back-to-top"
    aria-label="Back to top"
    onClick={() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: scrollTopBehavior(reduce) });
    }}
  >
    <ChevronUp size={18} aria-hidden="true" />
  </button>;
}
