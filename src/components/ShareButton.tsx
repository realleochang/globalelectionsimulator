import { useState } from 'react';
import { toPng } from 'html-to-image';

type Props = { captureRef: React.RefObject<HTMLDivElement | null> };

export function ShareButton({ captureRef }: Props) {
  const [status, setStatus] = useState<'idle'|'working'|'error'>('idle');

  const handleShare = async () => {
    if (!captureRef.current) return;
    setStatus('working');
    try {
      const opts = { pixelRatio: 2, cacheBust: true };
      await toPng(captureRef.current, opts);
      const dataUrl = await toPng(captureRef.current, opts);
      const a = document.createElement('a');
      a.download = `uk-election-${new Date().toISOString().slice(0,10)}.png`;
      a.href = dataUrl;
      a.click();
      setStatus('idle');
    } catch (err) {
      console.error(err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={status === 'working'}
      className={`h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] border transition-colors duration-75 tracking-wide uppercase ${
        status === 'error'
          ? 'border-red-200 text-red-600 hover:bg-red-50'
          : 'border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed'
      }`}
    >
      {status === 'working' ? 'Capturing…' : status === 'error' ? 'Failed · retry?' : '↓ Share PNG'}
    </button>
  );
}
