import { memo } from "react";
import { DividerInfo } from "../types";

interface Props {
  dividers: DividerInfo[];
  draggingDiv: number | null;
  onDividerDown: (idx: number, e: React.MouseEvent) => void;
}

export default memo(function SplitOverlay({ dividers, draggingDiv, onDividerDown }: Props) {
  return (
    <div className="split-overlay">
      {dividers.map((d, i) => (
        <div
          key={`${d.path.join("-")}-${d.childIdx}`}
          className={`split-divider ${d.dir} ${draggingDiv === i ? "dragging" : ""}`}
          style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
          onMouseDown={e => onDividerDown(i, e)}
        />
      ))}
    </div>
  );
});
