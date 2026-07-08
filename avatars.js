// Shared avatar icon set — simple ink-line SVGs matching the postcard/stamp
// visual identity, used on the landing page picker and shown next to
// players in the multiplayer lobby/leaderboard.
(function () {
  const AVATARS = [
    {
      key: 'pigeon',
      label: 'Pigeon voyageur',
      color: 'var(--brass)',
      svg: `<svg viewBox="0 0 100 100">
        <ellipse cx="46" cy="58" rx="27" ry="19" fill="currentColor"/>
        <circle cx="72" cy="40" r="15" fill="currentColor"/>
        <path d="M85,38 L98,34 L87,46 Z" fill="currentColor"/>
        <path d="M28,48 Q46,26 62,46 Q46,53 28,48 Z" fill="currentColor" opacity="0.55"/>
        <circle cx="75" cy="37" r="2.8" fill="#fff"/>
        <g stroke="currentColor" stroke-width="5" stroke-linecap="round">
          <path d="M26,64 L12,58"/>
          <path d="M28,71 L14,74"/>
        </g>
      </svg>`,
    },
    {
      key: 'stamp',
      label: 'Timbre',
      color: 'var(--red)',
      svg: `<svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round">
        <path d="M22,18 h56 a4,4 0 0 1 4,4 v56 a4,4 0 0 1 -4,4 h-56 a4,4 0 0 1 -4,-4 v-56 a4,4 0 0 1 4,-4 z"
          stroke-dasharray="1 11" stroke-linecap="round"/>
        <rect x="30" y="30" width="40" height="40" rx="2"/>
        <path d="M38,58 L46,44 L54,54 L62,40 L70,58" stroke-linecap="round"/>
        <circle cx="42" cy="40" r="3" fill="currentColor" stroke="none"/>
      </g></svg>`,
    },
    {
      key: 'envelope',
      label: 'Enveloppe',
      color: 'var(--blue)',
      svg: `<svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
        <rect x="16" y="28" width="68" height="46" rx="4"/>
        <path d="M18,30 L50,56 L82,30"/>
      </g></svg>`,
    },
    {
      key: 'seal',
      label: 'Cachet de cire',
      color: 'var(--bad)',
      svg: `<svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round">
        <path d="M50,16 C57,16 59,25 66,23 C73,21 79,28 75,34
          C82,38 80,48 73,50 C79,56 75,65 66,63
          C66,72 55,76 50,69 C45,76 34,72 34,63
          C25,65 21,56 27,50 C20,48 18,38 25,34
          C21,28 27,21 34,23 C41,25 43,16 50,16 Z"/>
        <circle cx="50" cy="46" r="9"/>
      </g></svg>`,
    },
    {
      key: 'quill',
      label: 'Plume à écrire',
      color: 'var(--ok)',
      svg: `<svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M78,18 C60,22 34,44 24,78 C50,72 78,50 82,22 C82,22 70,26 62,34"/>
        <path d="M24,78 L34,68"/>
        <path d="M58,30 Q52,42 40,52"/>
      </g></svg>`,
    },
    {
      key: 'compass',
      label: 'Boussole',
      color: 'var(--warn)',
      svg: `<svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
        <circle cx="50" cy="50" r="34"/>
        <path d="M50,28 L58,50 L50,72 L42,50 Z" fill="currentColor" opacity="0.3"/>
        <circle cx="50" cy="50" r="3" fill="currentColor" stroke="none"/>
      </g></svg>`,
    },
  ];

  function avatarByKey(key) {
    return AVATARS.find((a) => a.key === key) || AVATARS[0];
  }

  function avatarIconHtml(key, size) {
    const a = avatarByKey(key);
    const px = size || 40;
    return `<span class="avatar-icon" style="width:${px}px;height:${px}px;color:${a.color};" title="${a.label}">${a.svg}</span>`;
  }

  window.Avatars = { list: AVATARS, byKey: avatarByKey, iconHtml: avatarIconHtml };
})();
