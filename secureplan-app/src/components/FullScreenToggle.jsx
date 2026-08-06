import React from 'react';

export default function FullScreenToggle() {
  const [isFullscreen, setIsFullscreen] = React.useState(Boolean(document.fullscreenElement));

  React.useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      className="fullscreen-toggle-fab button button--secondary"
      onClick={toggle}
      aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
      title={isFullscreen ? 'Exit full screen' : 'Full screen'}
    >
      <span aria-hidden="true">⤢</span>
      <span>{isFullscreen ? 'Exit' : 'Full Screen'}</span>
    </button>
  );
}
