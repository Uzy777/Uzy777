import { mkdir, writeFile } from "node:fs/promises";
import * as simpleIcons from "simple-icons";

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

      recent: contributionsCollection(
        from: $recentFrom
        to: $to
      ) {
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

      year: contributionsCollection(
        from: $yearFrom
        to: $to
      ) {
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
          languages(
            first: 20
            orderBy: {
              field: SIZE
              direction: DESC
            }
          ) {
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

const user = payload.data.user;

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
    return {
      step: 1,
      maximum: 4,
    };
  }

  const targetIntervals = 4;
  const roughStep = maxValue / targetIntervals;

  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;

  let niceFraction;

  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

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
// Data
// ---------------------------------------------------------

const recentDays = flattenCalendar(
  recentCalendar,
  recentFrom
).slice(-30);

const yearDays = flattenCalendar(
  yearCalendar,
  yearFrom
);

const recentTotal = recentDays.reduce(
  (sum, day) => sum + day.contributionCount,
  0
);

const activeDays = yearDays.filter(
  (day) => day.contributionCount > 0
).length;

const longestActiveStreak = longestStreak(yearDays);

// ---------------------------------------------------------
// Languages
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

const sortedLanguages = [...languageTotals.entries()]
  .sort((a, b) => b[1] - a[1]);

const totalLanguageBytes = sortedLanguages.reduce(
  (total, [, bytes]) => total + bytes,
  0
);

const languages = sortedLanguages.slice(0, 5);

// ---------------------------------------------------------
// Simple Icons
// ---------------------------------------------------------

const allSimpleIcons = Object.values(simpleIcons).filter(
  (icon) =>
    icon &&
    typeof icon === "object" &&
    typeof icon.title === "string" &&
    typeof icon.slug === "string" &&
    typeof icon.path === "string"
);

const languageAliases = {
  HTML: "HTML5",
  Shell: "GNU Bash",
  Vue: "Vue.js",
  Java: "OpenJDK",
};

function normalizeIconName(value) {
  return value
    .toLowerCase()
    .replaceAll("+", "plus")
    .replaceAll("#", "sharp")
    .replaceAll(".", "dot")
    .replace(/[^a-z0-9]/g, "");
}

function findLanguageIcon(language) {
  const wanted =
    languageAliases[language] ?? language;

  const normalized = normalizeIconName(wanted);

  return allSimpleIcons.find((icon) => {
    return (
      normalizeIconName(icon.title) === normalized ||
      normalizeIconName(icon.slug) === normalized
    );
  });
}

function languageIcon(language, x, y, size, theme) {
  const icon = findLanguageIcon(language);

  if (!icon) {
    return `
      <circle
        cx="${x + size / 2}"
        cy="${y + size / 2}"
        r="${size / 2}"
        fill="${theme.track}"
      />

      <text
        x="${x + size / 2}"
        y="${y + size * 0.72}"
        fill="${theme.accent}"
        font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
        font-size="${size * 0.7}"
        font-weight="600"
        text-anchor="middle"
      >${escapeXml(language[0] ?? "?")}</text>
    `;
  }

  const scale = size / 24;

  return `
    <g transform="translate(${x} ${y}) scale(${scale})">
      <path
        d="${icon.path}"
        fill="${theme.accent}"
      />
    </g>
  `;
}

// ---------------------------------------------------------
// Activity SVG
// ---------------------------------------------------------

function createActivitySvg(theme) {
  const width = 800;
  const height = 285;

  const chart = {
    left: 68,
    right: 768,
    top: 92,
    bottom: 224,
  };

  const values = recentDays.map(
    (day) => day.contributionCount
  );

  const maximumValue = Math.max(...values, 0);

  const axis = niceAxisMaximum(maximumValue);

  const chartWidth = chart.right - chart.left;
  const chartHeight = chart.bottom - chart.top;

  const points = recentDays.map((day, index) => {
    const x =
      chart.left +
      (index / Math.max(recentDays.length - 1, 1)) *
        chartWidth;

    const y =
      chart.bottom -
      (day.contributionCount / axis.maximum) *
        chartHeight;

    return {
      x,
      y,
    };
  });

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
    value: "Last 30 days",
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

  // Y axis + horizontal grid lines
  for (
    let value = 0;
    value <= axis.maximum;
    value += axis.step
  ) {
    const y =
      chart.bottom -
      (value / axis.maximum) * chartHeight;

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

  // Y axis line
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

  // Area
  svg += `
    <polygon
      points="${areaPoints}"
      fill="url(#activity-fill)"
    />
  `;

  // Main line
  svg += `
    <polyline
      points="${linePoints}"
      fill="none"
      stroke="${theme.accent}"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  `;

  // Small final point
  const lastPoint = points.at(-1);

  if (lastPoint) {
    svg += `
      <circle
        cx="${lastPoint.x}"
        cy="${lastPoint.y}"
        r="3.5"
        fill="${theme.background}"
        stroke="${theme.accent}"
        stroke-width="2"
      />
    `;
  }

  // X axis date labels
  const labelIndexes = [0, 7, 14, 21, 29];

  for (const index of labelIndexes) {
    const day = recentDays[index];

    if (!day) {
      continue;
    }

    const x =
      chart.left +
      (index / Math.max(recentDays.length - 1, 1)) *
        chartWidth;

    svg += text({
      x,
      y: 251,
      value: formatDate(day.date),
      fill: theme.muted,
      size: 10,
      anchor:
        index === 0
          ? "start"
          : index === 29
            ? "end"
            : "middle",
    });
  }

  svg += text({
    x: 31,
    y: 162,
    value: "Contributions",
    fill: theme.muted,
    size: 10,
    anchor: "middle",
  }).replace(
    "<text",
    '<text transform="rotate(-90 31 162)"'
  );

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
      value: compact(yearCalendar.totalContributions),
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
    value: "Public + private activity · last 12 months",
    fill: theme.muted,
    size: 12,
  });

  metrics.forEach((metric, index) => {
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
  });

  svg += cardEnd();

  return svg;
}

// ---------------------------------------------------------
// Languages SVG
// ---------------------------------------------------------

function createLanguagesSvg(theme) {
  const width = 390;
  const height = 240;

  const iconX = 28;
  const labelX = 52;

  const barX = 145;
  const barWidth = 158;

  const percentX = 362;

  let svg = cardStart(
    width,
    height,
    theme,
    "Top programming languages"
  );

  svg += text({
    x: 28,
    y: 38,
    value: "Languages",
    fill: theme.text,
    size: 18,
    weight: 600,
  });

  svg += text({
    x: 28,
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

      const rowY = 85 + index * 29;

      const scaledBarWidth =
        (percentage / 100) * barWidth;

      svg += languageIcon(
        language,
        iconX,
        rowY - 4,
        16,
        theme
      );

      svg += text({
        x: labelX,
        y: rowY + 9,
        value: language,
        fill: theme.text,
        size: 11,
        weight: 500,
      });

      // Bar track
      svg += `
        <rect
          x="${barX}"
          y="${rowY}"
          width="${barWidth}"
          height="8"
          rx="4"
          fill="${theme.track}"
        />
      `;

      // Percentage bar
      svg += `
        <rect
          x="${barX}"
          y="${rowY}"
          width="${Math.max(
            scaledBarWidth,
            percentage > 0 ? 2 : 0
          ).toFixed(1)}"
          height="8"
          rx="4"
          fill="${theme.accent}"
        />
      `;

      // Percentage now has its own dedicated column
      svg += text({
        x: percentX,
        y: rowY + 8,
        value: `${percentage.toFixed(1)}%`,
        fill: theme.muted,
        size: 10,
        weight: 500,
        anchor: "end",
      });
    }
  );

  svg += cardEnd();

  return svg;
}

// ---------------------------------------------------------
// Generate files
// ---------------------------------------------------------

for (const [themeName, theme] of Object.entries(themes)) {
  const directory = `generated/${themeName}`;

  await mkdir(directory, {
    recursive: true,
  });

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

console.log("GitHub SVG stats generated successfully.");
