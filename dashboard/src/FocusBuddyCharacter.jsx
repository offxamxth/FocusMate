import React, { useState } from 'react';
import { focusBuddyImageFrames } from './focus-buddy.js';

export default function FocusBuddyCharacter({ character, animationState, onAnimationEnd }) {
  const [failedFrames, setFailedFrames] = useState([]);
  const frames = (focusBuddyImageFrames[animationState] || focusBuddyImageFrames.waiting)
    .filter((frame) => !failedFrames.includes(frame));

  return (
    <div
      className={`focus-buddy-character buddy-${character} is-${animationState}`}
      data-asset-status="user-png"
      onAnimationEnd={onAnimationEnd}
      aria-hidden="true"
    >
      {frames.map((frame) => (
        <img
          key={frame}
          className={`buddy-art buddy-art--${frame.replace('.png', '')}`}
          src={`/images/focus-buddy/${frame}`}
          alt=""
          draggable="false"
          onError={() => setFailedFrames((current) => (
            current.includes(frame) ? current : [...current, frame]
          ))}
        />
      ))}
    </div>
  );
}
