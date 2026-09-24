import { useRef, useState } from 'react';
import { Panel, getViewportForBounds, useReactFlow } from '@xyflow/react';
import { toPng } from 'html-to-image';

/** Big enough to read a thousand-node summary, small enough for any browser's canvas. */
const MAX_SIDE = 4096;
/** Twice the on-screen size, so text stays sharp when the image is scaled down. */
const MAX_SCALE = 2;
const MARGIN = 24;

/**
 * Saves the whole diagram as a PNG, framed around every node rather than
 * around whatever is on screen. Generated and downloaded in the page, so it
 * is as private as everything else here.
 */
export function SaveImage() {
  const { getNodes, getNodesBounds } = useReactFlow();
  const button = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);

  const save = async () => {
    const flow = button.current?.closest('.react-flow');
    const viewport = flow?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!flow || !viewport) return;

    // The instance's own bounds: it knows where nested nodes really are.
    const bounds = getNodesBounds(getNodes());
    const scale = Math.min(MAX_SCALE, MAX_SIDE / Math.max(bounds.width, bounds.height, 1));
    const width = Math.ceil(bounds.width * scale + MARGIN * 2);
    const height = Math.ceil(bounds.height * scale + MARGIN * 2);
    const { x, y, zoom } = getViewportForBounds(
      bounds,
      width,
      height,
      0.01,
      MAX_SCALE,
      `${MARGIN}px`,
    );

    try {
      const url = await toPng(viewport, {
        backgroundColor:
          getComputedStyle(flow).backgroundColor || getComputedStyle(document.body).backgroundColor,
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        },
      });
      const link = document.createElement('a');
      link.download = 'terravisual-diagram.png';
      link.href = url;
      link.click();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Panel position="top-right" className="save-image">
      <button ref={button} type="button" className="file-tab" onClick={() => void save()}>
        Save as PNG
      </button>
      {failed ? (
        <p className="save-image-error" role="status">
          The image could not be created in this browser.
        </p>
      ) : null}
    </Panel>
  );
}
