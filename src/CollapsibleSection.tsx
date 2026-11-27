import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  id: string;
  titleId: string;
  className?: string;
  expanded: boolean;
  onToggle: () => void;
  header: ReactNode;
  children: ReactNode;
};

export default function CollapsibleSection({ id, titleId, className, expanded, onToggle, header, children }: Props) {
  return <section id={id} className={className} aria-labelledby={titleId}>
    <div className="section-header">
      <h2 className="section-heading">
        <button type="button" className="section-toggle" aria-expanded={expanded} aria-controls={`${id}-panel`} aria-labelledby={titleId} onClick={onToggle}>
          {expanded
            ? <ChevronDown className="section-chevron" size={18} aria-hidden="true" />
            : <ChevronRight className="section-chevron" size={18} aria-hidden="true" />}
          {header}
        </button>
      </h2>
    </div>
    <div id={`${id}-panel`} className="section-panel" hidden={!expanded}>
      {children}
    </div>
  </section>;
}
