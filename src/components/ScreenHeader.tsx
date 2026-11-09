import { ReactNode } from "react";
import { Icon, ICONS } from "./Icons";

/** Top bar of a tool screen: back-to-home button, title, an optional badge and action buttons. */
export default function ScreenHeader(props: { title: string; badge?: ReactNode; onBack: () => void; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <button className="icon-btn back-btn" onClick={props.onBack} title="Back to home">
          <Icon d={ICONS.back} size={18} />
        </button>
        <span>{props.title}</span>
        {props.badge}
      </div>
      <div className="actions">{props.children}</div>
    </header>
  );
}
