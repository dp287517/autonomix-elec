function getRecommendedSection(inValue) {
  const inNum = parseFloat(String(inValue||'').match(/[\d.]+/)?.[0]) || 0;
  const cableSections = [
    { in: 2, section: 1.5 }, { in: 10, section: 1.5 }, { in: 16, section: 2.5 }, { in: 20, section: 2.5 },
    { in: 25, section: 4 }, { in: 32, section: 6 }, { in: 40, section: 10 }, { in: 50, section: 16 },
    { in: 63, section: 25 }, { in: 80, section: 35 }, { in: 100, section: 50 }, { in: 125, section: 70 },
    { in: 160, section: 95 }, { in: 200, section: 120 }, { in: 250, section: 150 }, { in: 315, section: 185 },
    { in: 400, section: 240 }, { in: 500, section: 300 }, { in: 630, section: 400 }, { in: 800, section: 500 },
    { in: 1000, section: 630 }, { in: 1250, section: 800 }, { in: 1600, section: 1000 }, { in: 2000, section: 1200 },
    { in: 2500, section: 1600 }
  ];
  for (let i=0;i<cableSections.length;i++) {
    if (inNum <= cableSections[i].in) return cableSections[i].section;
  }
  return 1600;
}

function normalizeIcn(icn) {
  if (!icn) return null;
  if (typeof icn === 'number' && !isNaN(icn) && icn > 0) return `${icn} kA`;
  if (typeof icn === 'string') {
    const match = icn.match(/[\d.]+/);
    if (!match) return null;
    const number = parseFloat(match[0]);
    if (isNaN(number) || number <= 0) return null;
    const unit = icn.match(/[a-zA-Z]+$/i) || [''];
    return `${number} ${unit[0].toLowerCase() === 'a' ? 'kA' : unit[0] || 'kA'}`;
  }
  return null;
}

module.exports = { getRecommendedSection, normalizeIcn };
