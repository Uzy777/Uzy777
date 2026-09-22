import { mkdir, readFile, writeFile } from "node:fs/promises";

const USERNAME = "Uzy777";
const token = process.env.PROFILE_STATS_TOKEN;

if (!token) {
  throw new Error("PROFILE_STATS_TOKEN is not available.");
}

// ---------------------------------------------------------
// Date ranges
// ---------------------------------------------------------

const now = new Date();

const recentFrom = new Date(now);
recentFrom.setUTCDate(recentFrom.getUTCDate() - 29);
recentFrom.setUTCHours(0, 0, 0, 0);

const yearFrom = new Date(now);
yearFrom.setUTCDate(yearFrom.getUTCDate() - 364);
yearFrom.setUTCHours(0, 0, 0, 0);

const to = now.toISOString();

// ---------------------------------------------------------
// GitHub GraphQL
// ---------------------------------------------------------

const query = `
  query(
    $login: String!
    $recentFrom: DateTime!
    $yearFrom: DateTime!
    $to: DateTime!
  ) {
    user(login: $login) {
      login

      recent: contributionsCollection(from: $recentFrom, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }

      year: contributionsCollection(from: $yearFrom, to: $to) {
        totalCommitContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }

      repositories(
        first: 100
        ownerAffiliations: [OWNER]
        privacy: PUBLIC
        isFork: false
      ) {
        nodes {
          languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
              }
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": `${USERNAME}-profile-stats`,
  },
  body: JSON.stringify({
    query,
    variables: {
      login: USERNAME,
      recentFrom: recentFrom.toISOString(),
      yearFrom: yearFrom.toISOString(),
      to,
    },
  }),
});

if (!response.ok) {
  throw new Error(
    `GitHub API returned ${response.status}: ${await response.text()}`
  );
}

const payload = await response.json();

if (payload.errors?.length) {
  throw new Error(JSON.stringify(payload.errors, null, 2));
}

const user = payload.data?.user;

if (!user) {
  throw new Error(`Could not find GitHub user ${USERNAME}.`);
}

const recentCalendar = user.recent.contributionCalendar;
const yearCalendar = user.year.contributionCalendar;

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compact(value) {
  return new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function flattenCalendar(calendar, fromDate) {
  const minimumDate = fromDate.toISOString().slice(0, 10);

  return calendar.weeks
    .flatMap((week) => week.contributionDays)
    .filter((day) => day.date >= minimumDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateString}T00:00:00Z`));
}

function longestStreak(days) {
  let longest = 0;
  let current = 0;

  for (const day of days) {
    if (day.contributionCount > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function niceAxisMaximum(maxValue) {
  if (maxValue <= 4) {
    return { step: 1, maximum: 4 };
  }

  const roughStep = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;

  let niceFraction;

  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  const step = niceFraction * magnitude;

  return {
    step,
    maximum: Math.ceil(maxValue / step) * step,
  };
}

function cardStart(width, height, theme, title) {
  return `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
  role="img"
>
  <title>${escapeXml(title)}</title>

  <rect
    x="1"
    y="1"
    width="${width - 2}"
    height="${height - 2}"
    rx="16"
    fill="${theme.background}"
    stroke="${theme.border}"
  />
`;
}

function cardEnd() {
  return "</svg>";
}

function text({
  x,
  y,
  value,
  fill,
  size = 14,
  weight = 400,
  anchor = "start",
  opacity = 1,
}) {
  return `
  <text
    x="${x}"
    y="${y}"
    fill="${fill}"
    font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
    font-size="${size}"
    font-weight="${weight}"
    text-anchor="${anchor}"
    opacity="${opacity}"
  >${escapeXml(value)}</text>`;
}

// ---------------------------------------------------------
// Theme
// ---------------------------------------------------------

const themes = {
  dark: {
    background: "#0D1117",
    border: "#30363D",
    text: "#F0F6FC",
    muted: "#8B949E",
    accent: "#539BF5",
    grid: "#21262D",
    track: "#21262D",
  },

  light: {
    background: "#FFFFFF",
    border: "#D0D7DE",
    text: "#1F2328",
    muted: "#656D76",
    accent: "#0969DA",
    grid: "#EAEEF2",
    track: "#EAEEF2",
  },
};

// ---------------------------------------------------------
// Contribution data
// ---------------------------------------------------------

const recentContributionMap = new Map(
  flattenCalendar(recentCalendar, recentFrom).map((day) => [
    day.date,
    day.contributionCount,
  ])
);

// Guarantee exactly the last 30 calendar days, including zero days.
const recentDays = [];

const today = new Date();
today.setUTCHours(0, 0, 0, 0);

for (let offset = 29; offset >= 0; offset--) {
  const date = new Date(today);

  date.setUTCDate(today.getUTCDate() - offset);

  const dateString = date.toISOString().slice(0, 10);

  recentDays.push({
    date: dateString,
    contributionCount: recentContributionMap.get(dateString) ?? 0,
  });
}

const yearDays = flattenCalendar(yearCalendar, yearFrom);

const recentTotal = recentDays.reduce(
  (sum, day) => sum + day.contributionCount,
  0
);

const activeDays = yearDays.filter(
  (day) => day.contributionCount > 0
).length;

const longestActiveStreak = longestStreak(yearDays);

// ---------------------------------------------------------
// Public repository languages
// ---------------------------------------------------------

const ignoredLanguages = new Set([
  "Jupyter Notebook",
  "Roff",
]);

const languageTotals = new Map();

for (const repo of user.repositories.nodes) {
  for (const edge of repo.languages.edges) {
    const language = edge.node.name;

    if (ignoredLanguages.has(language)) {
      continue;
    }

    languageTotals.set(
      language,
      (languageTotals.get(language) ?? 0) + edge.size
    );
  }
}

const sortedLanguages = [...languageTotals.entries()].sort(
  (a, b) => b[1] - a[1]
);

const totalLanguageBytes = sortedLanguages.reduce(
  (total, [, bytes]) => total + bytes,
  0
);

const languages = sortedLanguages.slice(0, 5);

// ---------------------------------------------------------
// Devicon language icons
// ---------------------------------------------------------

const deviconPaths = {
  Python: "python/python-original.svg",
  JavaScript: "javascript/javascript-original.svg",
  TypeScript: "typescript/typescript-original.svg",
  HTML: "html5/html5-original.svg",
  CSS: "css3/css3-original.svg",
  "C#": "csharp/csharp-original.svg",
  C: "c/c-original.svg",
  "C++": "cplusplus/cplusplus-original.svg",
  Java: "java/java-original.svg",
  PHP: "php/php-original.svg",
  Go: "go/go-original.svg",
  Rust: "rust/rust-original.svg",
  Shell: "bash/bash-original.svg",
};

async function loadDevicon(language) {
  const relativePath = deviconPaths[language];

  if (!relativePath) {
    return null;
  }

  try {
    const fileUrl = new URL(
      `../node_modules/devicon/icons/${relativePath}`,
      import.meta.url
    );

    const source = await readFile(fileUrl, "utf8");

    const viewBox =
      source.match(/viewBox=["']([^"']+)["']/i)?.[1] ??
      "0 0 128 128";

    const inner = source
      .replace(/^[\s\S]*?<svg[^>]*>/i, "")
      .replace(/<\/svg>\s*$/i, "");

    return {
      viewBox,
      inner,
    };
  } catch {
    return null;
  }
}

const languageIcons = new Map();

for (const [language] of languages) {
  languageIcons.set(
    language,
    await loadDevicon(language)
  );
}

function renderLanguageIcon(
  language,
  x,
  y,
  size,
  theme
) {
  const icon = languageIcons.get(language);

  if (!icon) {
    return `
      <circle
        cx="${x + size / 2}"
        cy="${y + size / 2}"
        r="${size / 2}"
        fill="${theme.track}"
      />

      ${text({
        x: x + size / 2,
        y: y + size * 0.72,
        value: language[0] ?? "?",
        fill: theme.accent,
        size: size * 0.7,
        weight: 600,
        anchor: "middle",
      })}
    `;
  }

  return `
    <svg
      x="${x}"
      y="${y}"
      width="${size}"
      height="${size}"
      viewBox="${icon.viewBox}"
      preserveAspectRatio="xMidYMid meet"
    >
      ${icon.inner}
    </svg>
  `;
}

// ---------------------------------------------------------
// Activity SVG
// ---------------------------------------------------------

function createActivitySvg(theme) {
  const width = 800;
  const height = 300;

  const chart = {
    left: 64,
    right: 770,
    top: 92,
    bottom: 230,
  };

  const chartWidth =
    chart.right - chart.left;

  const chartHeight =
    chart.bottom - chart.top;

  const values = recentDays.map(
    (day) => day.contributionCount
  );

  const maximumValue =
    Math.max(...values, 0);

  const axis =
    niceAxisMaximum(maximumValue);

  const points = recentDays.map(
    (day, index) => {
      const x =
        chart.left +
        (index /
          Math.max(recentDays.length - 1, 1)) *
          chartWidth;

      const y =
        chart.bottom -
        (day.contributionCount / axis.maximum) *
          chartHeight;

      return {
        x,
        y,
        day,
        dayNumber: index + 1,
      };
    }
  );

  const linePoints = points
    .map(
      ({ x, y }) =>
        `${x.toFixed(1)},${y.toFixed(1)}`
    )
    .join(" ");

  const areaPoints = [
    `${chart.left},${chart.bottom}`,

    ...points.map(
      ({ x, y }) =>
        `${x.toFixed(1)},${y.toFixed(1)}`
    ),

    `${chart.right},${chart.bottom}`,
  ].join(" ");

  let svg = cardStart(
    width,
    height,
    theme,
    "GitHub contribution activity"
  );

  svg += `
    <defs>
      <linearGradient
        id="activity-fill"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop
          offset="0%"
          stop-color="${theme.accent}"
          stop-opacity="0.24"
        />

        <stop
          offset="100%"
          stop-color="${theme.accent}"
          stop-opacity="0.02"
        />
      </linearGradient>
    </defs>
  `;

  // Header
  svg += text({
    x: 28,
    y: 38,
    value: "Contribution activity",
    fill: theme.text,
    size: 18,
    weight: 600,
  });

  svg += text({
    x: 28,
    y: 61,
    value: "Last 30 days · Day 30 is today",
    fill: theme.muted,
    size: 12,
  });

  svg += text({
    x: 772,
    y: 39,
    value: `${compact(recentTotal)} contributions`,
    fill: theme.accent,
    size: 14,
    weight: 600,
    anchor: "end",
  });

  // ---------------------------------------------------------
  // Y axis + grid
  // ---------------------------------------------------------

  for (
    let value = 0;
    value <= axis.maximum;
    value += axis.step
  ) {
    const y =
      chart.bottom -
      (value / axis.maximum) *
        chartHeight;

    svg += `
      <line
        x1="${chart.left}"
        y1="${y}"
        x2="${chart.right}"
        y2="${y}"
        stroke="${theme.grid}"
        stroke-width="1"
      />
    `;

    svg += text({
      x: chart.left - 12,
      y: y + 4,
      value,
      fill: theme.muted,
      size: 10,
      anchor: "end",
    });
  }

  // Y axis
  svg += `
    <line
      x1="${chart.left}"
      y1="${chart.top}"
      x2="${chart.left}"
      y2="${chart.bottom}"
      stroke="${theme.border}"
      stroke-width="1"
    />
  `;

  // X axis
  svg += `
    <line
      x1="${chart.left}"
      y1="${chart.bottom}"
      x2="${chart.right}"
      y2="${chart.bottom}"
      stroke="${theme.border}"
      stroke-width="1"
    />
  `;

  // ---------------------------------------------------------
  // Area + line
  // ---------------------------------------------------------

  svg += `
    <polygon
      points="${areaPoints}"
      fill="url(#activity-fill)"
    />

    <polyline
      points="${linePoints}"
      fill="none"
      stroke="${theme.accent}"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  `;

  // ---------------------------------------------------------
  // Individual days
  // ---------------------------------------------------------

  points.forEach(
    ({ x, y, dayNumber }) => {
      // Point
      svg += `
        <circle
          cx="${x}"
          cy="${y}"
          r="2"
          fill="${theme.accent}"
        />
      `;

      // Tick
      svg += `
        <line
          x1="${x}"
          y1="${chart.bottom}"
          x2="${x}"
          y2="${chart.bottom + 4}"
          stroke="${theme.border}"
          stroke-width="1"
        />
      `;

      // 1 → 30 labels
      svg += text({
        x,
        y: 249,
        value: dayNumber,
        fill: theme.muted,
        size: 8,
        anchor: "middle",
      });
    }
  );

  // Y-axis title
  svg += `
    <text
      x="24"
      y="161"
      transform="rotate(-90 24 161)"
      fill="${theme.muted}"
      font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
      font-size="10"
      text-anchor="middle"
    >
      Contributions
    </text>
  `;

  // X-axis title
  svg += text({
    x: chart.left + chartWidth / 2,
    y: 280,
    value: "Day",
    fill: theme.muted,
    size: 10,
    anchor: "middle",
  });

  svg += cardEnd();

  return svg;
}

// ---------------------------------------------------------
// Stats SVG
// ---------------------------------------------------------

function createStatsSvg(theme) {
  const width = 390;
  const height = 240;

  const metrics = [
    {
      label: "Contributions",
      value: compact(
        yearCalendar.totalContributions
      ),
    },

    {
      label: "Commits",
      value: compact(
        user.year.totalCommitContributions
      ),
    },

    {
      label: "Active days",
      value: activeDays,
    },

    {
      label: "Longest streak",
      value: `${longestActiveStreak}d`,
    },
  ];

  let svg = cardStart(
    width,
    height,
    theme,
    "GitHub statistics"
  );

  svg += text({
    x: 28,
    y: 38,
    value: "GitHub stats",
    fill: theme.text,
    size: 18,
    weight: 600,
  });

  svg += text({
    x: 28,
    y: 61,
    value:
      "Public + private contributions · last 12 months",
    fill: theme.muted,
    size: 12,
  });

  metrics.forEach(
    (metric, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);

      const x =
        column === 0
          ? 28
          : 210;

      const y =
        111 + row * 72;

      svg += text({
        x,
        y,
        value: metric.value,
        fill: theme.accent,
        size: 25,
        weight: 600,
      });

      svg += text({
        x,
        y: y + 23,
        value: metric.label,
        fill: theme.muted,
        size: 12,
      });
    }
  );

  svg += cardEnd();

  return svg;
}

// ---------------------------------------------------------
// Languages SVG
// ---------------------------------------------------------

function createLanguagesSvg(theme) {
  const width = 390;
  const height = 280;

  const left = 28;
  const right = 362;

  const fullBarWidth =
    right - left;

  const rowStart = 91;
  const rowSpacing = 38;

  // The largest language becomes the visual 100% width.
  // Other bars are ranked proportionally against it.
  const largestLanguageBytes =
    languages[0]?.[1] ?? 1;

  let svg = cardStart(
    width,
    height,
    theme,
    "Top programming languages"
  );

  svg += text({
    x: left,
    y: 38,
    value: "Languages",
    fill: theme.text,
    size: 18,
    weight: 600,
  });

  svg += text({
    x: left,
    y: 61,
    value: "Public repositories · by code size",
    fill: theme.muted,
    size: 12,
  });

  languages.forEach(
    ([language, bytes], index) => {
      const percentage =
        totalLanguageBytes === 0
          ? 0
          : (bytes / totalLanguageBytes) * 100;

      // Bar ranking relative to largest language.
      const relative =
        largestLanguageBytes === 0
          ? 0
          : bytes / largestLanguageBytes;

      const rowY =
        rowStart +
        index * rowSpacing;

      const iconSize = 18;

      const barY =
        rowY + 11;

      const fillWidth =
        fullBarWidth * relative;

      // -----------------------------------------------------
      // Icon
      // -----------------------------------------------------

      svg += renderLanguageIcon(
        language,
        left,
        rowY - 14,
        iconSize,
        theme
      );

      // -----------------------------------------------------
      // Language
      // -----------------------------------------------------

      svg += text({
        x: left + 28,
        y: rowY,
        value: language,
        fill: theme.text,
        size: 11,
        weight: 600,
      });

      // -----------------------------------------------------
      // Actual percentage
      // -----------------------------------------------------

      svg += text({
        x: right,
        y: rowY,
        value: `${percentage.toFixed(1)}%`,
        fill: theme.muted,
        size: 10,
        weight: 500,
        anchor: "end",
      });

      // -----------------------------------------------------
      // Background track
      // -----------------------------------------------------

      svg += `
        <rect
          x="${left}"
          y="${barY}"
          width="${fullBarWidth}"
          height="7"
          rx="3.5"
          fill="${theme.track}"
        />
      `;

      // -----------------------------------------------------
      // Relative ranking bar
      // -----------------------------------------------------

      svg += `
        <rect
          x="${left}"
          y="${barY}"
          width="${Math.max(
            fillWidth,
            bytes > 0 ? 3 : 0
          ).toFixed(1)}"
          height="7"
          rx="3.5"
          fill="${theme.accent}"
        />
      `;
    }
  );

  svg += cardEnd();

  return svg;
}

// ---------------------------------------------------------
// Generate files
// ---------------------------------------------------------

for (
  const [themeName, theme]
  of Object.entries(themes)
) {
  const directory =
    `generated/${themeName}`;

  await mkdir(
    directory,
    {
      recursive: true,
    }
  );

  await Promise.all([
    writeFile(
      `${directory}/activity.svg`,
      createActivitySvg(theme),
      "utf8"
    ),

    writeFile(
      `${directory}/stats.svg`,
      createStatsSvg(theme),
      "utf8"
    ),

    writeFile(
      `${directory}/languages.svg`,
      createLanguagesSvg(theme),
      "utf8"
    ),
  ]);
}

console.log(
  "GitHub SVG stats generated successfully."
);
