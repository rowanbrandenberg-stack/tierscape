/** The drawn sample lot, in feet, used for the sample job and when imagery is off. */
export function SampleLot() {
  return (
    <g data-sample-lot="" transform="scale(.25)">
      <rect width="640" height="420" fill="#a39d72" />
      <g fill="#978f66" opacity=".7">
        <ellipse cx="520" cy="210" rx="70" ry="40" />
        <ellipse cx="420" cy="320" rx="90" ry="30" />
        <ellipse cx="150" cy="100" rx="80" ry="34" />
        <ellipse cx="560" cy="80" rx="50" ry="40" />
      </g>
      <rect x="0" y="372" width="640" height="48" fill="#5d5f61" />
      <path d="M0 396H640" stroke="#d9c85a" strokeWidth="2" strokeDasharray="18 14" />
      <rect x="0" y="358" width="640" height="14" fill="#c4c1b6" />
      <rect x="72" y="262" width="84" height="98" fill="#b9b6ab" />
      <path d="M40 14H600V358M40 14V358" fill="none" stroke="#6b5a45" strokeWidth="2.5" />
      <rect x="64" y="156" width="304" height="112" fill="#00000030" />
      <rect x="58" y="150" width="304" height="112" fill="#7b695b" />
      <path d="M58 150L114 206L58 262ZM362 150L306 206L362 262Z" fill="#6c5b4e" />
      <path d="M58 150H362L306 206H114Z" fill="#877466" />
      <path d="M114 206H306" stroke="#5a4b40" strokeWidth="2" />
      <rect x="540" y="30" width="44" height="36" fill="#6a6f73" />
      {[[524, 246, 30], [440, 306, 22], [238, 318, 20], [566, 150, 18]].map(([x, y, r]) => (
        <g key={`${x}`}>
          <circle cx={x + 5} cy={y + 5} r={r} fill="#00000030" />
          <circle cx={x} cy={y} r={r} fill="#35593b" />
        </g>
      ))}
    </g>
  );
}
