// 오리지널 고양이 마법소녀 의상. 원본 그림 좌표(1086×1448) 위에 SVG로 그린다.
// 뒤(망토·꼬리)는 아이 레이어보다 먼저, 앞(칼라·리본·치마·머리띠·브로치)은 나중에 그린다.
// pop(키) 값이 0→1로 올라가며 조각마다 튀어나오듯 나타난다.
import React from 'react';

const PINK = '#ff8cc0';
const PINK_D = '#e2589a';
const PINK_L = '#ffd1e6';
const LAV = '#cdb3ff';
const GOLD = '#ffd25e';
const GOLD_D = '#d9a332';
const WHITE = '#fffafd';
const LINE = '#8a3d64';

export type Pops = { cape: number; collar: number; skirt: number; ribbon: number; ears: number; tail: number; cat: number };

function popStyle(p: number, ox: number, oy: number): React.CSSProperties {
  const s = p <= 0 ? 0.001 : p;
  return { transform: `scale(${s})`, transformOrigin: `${ox}px ${oy}px`, transformBox: 'view-box', opacity: Math.min(1, p * 1.5) };
}

const Defs: React.FC = () => (
  <defs>
    <linearGradient id="cape" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ffc2e0" />
      <stop offset="0.6" stopColor="#e9b6ff" />
      <stop offset="1" stopColor={LAV} />
    </linearGradient>
    <linearGradient id="capeIn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#f7a4cf" />
      <stop offset="1" stopColor="#b48cf0" />
    </linearGradient>
    <linearGradient id="skirt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ffa6cf" />
      <stop offset="1" stopColor="#ff7fb8" />
    </linearGradient>
    <radialGradient id="gold" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stopColor="#fff6c9" />
      <stop offset="0.5" stopColor={GOLD} />
      <stop offset="1" stopColor={GOLD_D} />
    </radialGradient>
    <linearGradient id="bow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ffb3d6" />
      <stop offset="1" stopColor={PINK_D} />
    </linearGradient>
  </defs>
);

export const CostumeBack: React.FC<{ pops: Pops }> = ({ pops }) => (
  <svg viewBox="0 0 1086 1448" width={1086} height={1448} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
    <Defs />
    {/* 짧은 망토: 어깨에서 엉덩이 높이까지, 바람에 살짝 펄럭 */}
    <g style={popStyle(pops.cape, 740, 560)}>
      <path
        d="M600 560 C560 640 520 760 500 900 C540 930 600 915 640 950 C700 930 760 960 820 940 C880 965 960 930 1010 955 C1060 900 1060 760 1030 640 C990 580 930 540 870 520 Z"
        fill="url(#capeIn)"
        stroke={LINE}
        strokeWidth={4}
      />
      <path
        d="M610 560 C575 650 545 760 528 880 C560 900 610 890 645 915 C700 900 760 925 815 905 C875 925 950 900 1000 918 C1035 860 1035 750 1012 650 C975 590 925 555 870 535 Z"
        fill="url(#cape)"
        opacity={0.95}
      />
      <path d="M500 900 C540 930 600 915 640 950 C700 930 760 960 820 940 C880 965 960 930 1010 955" fill="none" stroke={GOLD} strokeWidth={9} strokeLinecap="round" />
    </g>
    {/* 꼬리 장식: 허리 뒤에서 오른쪽으로 말려 올라감, 끝에 리본 */}
    <g style={popStyle(pops.tail, 1000, 1040)}>
      <path d="M990 1050 C1060 1060 1090 1000 1070 940 C1055 895 1080 860 1110 855" fill="none" stroke={LINE} strokeWidth={36} strokeLinecap="round" />
      <path d="M990 1050 C1060 1060 1090 1000 1070 940 C1055 895 1080 860 1110 855" fill="none" stroke={WHITE} strokeWidth={28} strokeLinecap="round" />
      <path d="M1068 930 C1060 900 1078 870 1110 856" fill="none" stroke={PINK_L} strokeWidth={22} strokeLinecap="round" />
      <g transform="translate(1052 985) rotate(-20)">
        <path d="M0 0 C-40 -30 -50 20 0 6 C50 20 40 -30 0 0Z" fill="url(#bow)" stroke={LINE} strokeWidth={3} />
        <circle r={9} fill={GOLD} stroke={GOLD_D} strokeWidth={2} />
      </g>
    </g>
  </svg>
);

export const CostumeFront: React.FC<{ pops: Pops; head?: { angle: number; rise: number }; neck?: { x: number; y: number } }> = ({
  pops,
  head = { angle: 0, rise: 0 },
  neck = { x: 675, y: 560 },
}) => (
  <svg viewBox="0 0 1086 1448" width={1086} height={1448} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
    <Defs />
    {/* 치마: 허리선에서 크게 퍼지는 2단 주름치마, 물결 밑단 */}
    <g style={popStyle(pops.skirt, 870, 990)}>
      <path
        d="M694 975 C800 960 930 950 1046 955 C1070 1020 1086 1080 1100 1140 Q1065 1168 1030 1146 Q995 1172 960 1150 Q925 1175 890 1152 Q855 1176 820 1152 Q785 1174 750 1150 Q715 1170 680 1146 Q650 1160 630 1135 C650 1080 670 1020 694 975 Z"
        fill={WHITE}
        stroke={LINE}
        strokeWidth={4}
      />
      <path
        d="M694 975 C800 960 930 950 1046 955 C1064 1010 1076 1055 1086 1100 Q1050 1124 1016 1104 Q982 1128 948 1106 Q914 1130 880 1108 Q846 1131 812 1108 Q778 1130 744 1106 Q710 1126 676 1102 Q660 1110 648 1096 C662 1050 676 1010 694 975 Z"
        fill="url(#skirt)"
        stroke={LINE}
        strokeWidth={4}
      />
      {[0.14, 0.3, 0.46, 0.62, 0.78, 0.92].map((t) => {
        const x0 = 694 + (1046 - 694) * t;
        const x1 = 655 + (1080 - 655) * t;
        return <path key={t} d={`M${x0} ${970 - 14 * Math.sin(t * 3)} L${x1} ${1104}`} stroke={PINK_D} strokeWidth={4} opacity={0.55} />;
      })}
      <path d="M694 975 C800 960 930 950 1046 955" fill="none" stroke={GOLD} strokeWidth={14} strokeLinecap="round" />
    </g>
    {/* 세일러 칼라: 흰 바탕에 분홍 줄 두 개, 가슴에서 V로 모임 */}
    <g style={popStyle(pops.collar, 730, 625)}>
      <g transform="translate(0 26) scale(0.94) translate(46 0)">
      <path
        d="M588 566 C620 548 650 540 672 545 C690 585 708 610 730 628 C752 606 772 575 790 535 C830 522 870 512 896 505 C905 560 880 640 818 700 C790 728 760 748 730 760 C700 746 668 724 640 694 C600 650 585 610 588 566 Z"
        fill={WHITE}
        stroke={LINE}
        strokeWidth={5}
      />
      <path d="M603 578 C603 622 618 662 650 694 C676 720 704 738 730 746 C757 735 785 716 810 690 C858 640 880 580 880 520" fill="none" stroke={PINK} strokeWidth={8} />
      <path d="M618 586 C620 622 634 656 660 682 C684 706 708 720 730 727 C752 718 776 702 798 680 C840 636 860 586 862 532" fill="none" stroke={PINK} strokeWidth={5} />
      </g>
    </g>
    {/* 큰 리본 + 고양이 발바닥 브로치 */}
    <g style={popStyle(pops.ribbon, 730, 770)}>
      <path d="M716 790 C700 840 690 880 672 930 L700 915 L716 945 C726 890 732 840 736 795 Z" fill={PINK_D} stroke={LINE} strokeWidth={4} />
      <path d="M744 790 C760 840 772 880 792 926 L764 913 L748 942 C740 888 734 840 728 795 Z" fill={PINK_D} stroke={LINE} strokeWidth={4} />
      <path d="M730 770 C680 712 600 708 596 760 C592 812 668 818 730 784 Z" fill="url(#bow)" stroke={LINE} strokeWidth={5} />
      <path d="M730 770 C780 712 860 708 864 760 C868 812 792 818 730 784 Z" fill="url(#bow)" stroke={LINE} strokeWidth={5} />
      <path d="M640 742 C660 735 690 745 710 765" fill="none" stroke="#ffe3f0" strokeWidth={7} strokeLinecap="round" opacity={0.8} />
      <path d="M820 742 C800 735 770 745 750 765" fill="none" stroke="#ffe3f0" strokeWidth={7} strokeLinecap="round" opacity={0.8} />
      <circle cx={730} cy={777} r={34} fill="url(#gold)" stroke={GOLD_D} strokeWidth={4} />
      <ellipse cx={730} cy={786} rx={13} ry={10} fill={PINK} />
      {[
        [-15, -7],
        [-5, -15],
        [6, -15],
        [16, -7],
      ].map(([dx, dy], i) => (
        <ellipse key={i} cx={730 + dx} cy={777 + dy} rx={5.5} ry={6.5} fill={PINK} />
      ))}
    </g>
    {/* 고양이 귀 머리띠: 머리 갸웃·숨쉬기를 따라 움직인다 */}
    <g transform={`translate(0 ${-head.rise}) rotate(${head.angle} ${neck.x} ${neck.y})`}>
    <g style={popStyle(pops.ears, 690, 190)}>
      <path d="M548 262 C580 172 690 140 800 172 C830 182 850 200 862 222" fill="none" stroke={LINE} strokeWidth={20} strokeLinecap="round" />
      <path d="M548 262 C580 172 690 140 800 172 C830 182 850 200 862 222" fill="none" stroke={PINK_L} strokeWidth={13} strokeLinecap="round" />
      <path d="M588 196 L590 90 L670 158 Z" fill={WHITE} stroke={LINE} strokeWidth={5} strokeLinejoin="round" />
      <path d="M602 178 L604 118 L650 160 Z" fill={PINK} />
      <path d="M738 152 L812 72 L826 176 Z" fill={WHITE} stroke={LINE} strokeWidth={5} strokeLinejoin="round" />
      <path d="M754 152 L806 100 L814 162 Z" fill={PINK} />
      <circle cx={700} cy={152} r={14} fill="url(#gold)" stroke={GOLD_D} strokeWidth={3} />
    </g>
    </g>
    {/* 고양이도 리본 하나 */}
    <g style={popStyle(pops.cat, 238, 652)}>
      <path d="M238 652 C214 628 188 636 192 656 C196 676 222 670 238 660 Z" fill="url(#bow)" stroke={LINE} strokeWidth={3} />
      <path d="M238 652 C262 628 288 636 284 656 C280 676 254 670 238 660 Z" fill="url(#bow)" stroke={LINE} strokeWidth={3} />
      <circle cx={238} cy={656} r={8} fill={GOLD} stroke={GOLD_D} strokeWidth={2} />
    </g>
  </svg>
);
