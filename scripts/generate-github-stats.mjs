import { mkdir, writeFile } from "node:fs/promises";

const USERNAME = "Uzy777";
const token = process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("GITHUB_TOKEN is not available.");
}

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - 1);

const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      createdAt

      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions

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
        totalCount

        nodes {
          stargazerCount

          languages(
            first: 10
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
      from: from.toISOString(),
      to: now.toISOString(),
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

const contributions = user.contributionsCollection;
const calendar = contributions.contributionCalendar;
const repositories = user.repositories.nodes;

const totalStars = repositories.reduce(
  (total, repo) => total + repo.stargazerCount,
  0
);

// Aggregate languages across public, non-fork repositories.
const languageTotals = new Map();

for (const repo of repositories) {
  for (const edge of repo.languages.edges) {
    languageTotals.set(
      edge.node.name,
      (languageTotals.get(edge.node.name) ?? 0) + edge.size
    );
  }
}

const languages = [...languageTotals.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);

const totalLanguageBytes = [...languageTotals.values()].reduce(
  (sum, value) => sum + value,
  0
);

// Turn GitHub's daily contribution data into weekly totals.
const weeklyContributions = calendar.weeks.map((week) =>
  week.contributionDays.reduce(
    (sum, day) => sum + day.contributionCount,
    0
  )
);

const themes = {
  dark: {
    background: "#0D1117",
    border: "#30363D",
    text: "#F0F6FC",
    muted: "#8B949E",
    accent: "#539BF5",
    track: "#21262D",
  },

  light: {
    background: "#FFFFFF",
    border: "#D0D7DE",
    text: "#1F2328",
    muted: "#656D76",
    accent: "#0969DA",
    track: "#EAEEF2",
  },
};

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

function monthLabel(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
  }).format(new Date(`${dateString}T00:00:00Z`));
}

function cardStart(width, height, theme) {
  return `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
  role="img"
>
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

function createActivitySvg(theme) {
  const width = 800;
  const height = 260;

  const chart = {
    left: 32,
    right: 768,
    top: 105,
    bottom: 215,
  };

  const values = weeklyContributions;
  const max = Math.max(...values, 1);

  const points = values.map((value, index) => {
    const x =
      chart.left +
      (index / Math.max(values.length - 1, 1)) *
        (chart.right - chart.left);

    const y =
      chart.bottom -
      (value / max) * (chart.bottom - chart.top);

    return { x, y };
  });

  const linePoints = points
    .map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const areaPoints = [
    `${chart.left},${chart.bottom}`,
    ...points.map(
      ({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`
    ),
    `${chart.right},${chart.bottom}`,
  ].join(" ");

  const weeks = calendar.weeks;
  const labelIndexes = [
    0,
    Math.floor((weeks.length - 1) * 0.25),
    Math.floor((weeks.length - 1) * 0.5),
    Math.floor((weeks.length - 1) * 0.75),
    weeks.length - 1,
  ];

  let svg = cardStart(width, height, theme);

  svg += text({
    x: 32,
    y: 40,
    value: "Contribution activity",
    fill: theme.text,
    size: 18,
    weight: 600,
  });

  svg += text({
    x: 32,
    y: 65,
    value: "Last 12 months",
    fill: theme.muted,
    size: 13,
  });

  svg += text({
    x: 768,
    y: 42,
    value: `${compact(calendar.totalContributions)} contributions`,
    fill: theme.accent,
    size: 15,
    weight: 600,
    anchor: "end",
  });

  svg += `
  <line
    x1="${chart.left}"
    y1="${chart.bottom}"
    x2="${chart.right}"
    y2="${chart.bottom}"
    stroke="${theme.border}"
  />

  <polygon
    points="${areaPoints}"
    fill="${theme.accent}"
    opacity="0.12"
  />

  <polyline
    points="${linePoints}"
    fill="none"
    stroke="${theme.accent}"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
`;

  for (const index of labelIndexes) {
    const week = weeks[index];

    if (!week) continue;

    const x =
      chart.left +
      (index / Math.max(weeks.length - 1, 1)) *
        (chart.right - chart.left);

    const firstDay = week.contributionDays[0]?.date;

    if (!firstDay) continue;

    svg += text({
      x,
      y: 239,
      value: monthLabel(firstDay),
      fill: theme.muted,
      size: 11,
      anchor:
        index === 0
          ? "start"
          : index === weeks.length - 1
            ? "end"
            : "middle",
    });
  }

  svg += cardEnd();

  return svg;
}

function createStatsSvg(theme) {
  const width = 390;
  const height = 240;

  const metrics = [
    ["Contributions", compact(calendar.totalContributions)],
    ["Commits", compact(contributions.totalCommitContributions)],
    ["Pull requests", compact(contributions.totalPullRequestContributions)],
    ["Issues", compact(contributions.totalIssueContributions)],
    ["Public repos", compact(user.repositories.totalCount)],
    ["Stars", compact(totalStars)],
  ];

  let svg = cardStart(width, height, theme);

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
    value: "Last 12 months · public repositories",
    fill: theme.muted,
    size: 12,
  });

  metrics.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);

    const x = column === 0 ? 28 : 210;
    const y = 103 + row * 54;

    svg += text({
      x,
      y,
      value,
      fill: theme.accent,
      size: 22,
      weight: 600,
    });

    svg += text({
      x,
      y: y + 20,
      value: label,
      fill: theme.muted,
      size: 12,
    });
  });

  svg += cardEnd();

  return svg;
}

function createLanguagesSvg(theme) {
  const width = 390;
  const height = 240;

  let svg = cardStart(width, height, theme);

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
    value: "Across public, non-fork repositories",
    fill: theme.muted,
    size: 12,
  });

  const barX = 125;
  const maxBarWidth = 210;

  languages.forEach(([name, bytes], index) => {
    const percentage =
      totalLanguageBytes === 0
        ? 0
        : (bytes / totalLanguageBytes) * 100;

    const y = 91 + index * 29;
    const barWidth = Math.max(
      2,
      (percentage / 100) * maxBarWidth
    );

    svg += text({
      x: 28,
      y: y + 10,
      value: name,
      fill: theme.text,
      size: 12,
    });

    svg += `
  <rect
    x="${barX}"
    y="${y}"
    width="${maxBarWidth}"
    height="10"
    rx="5"
    fill="${theme.track}"
  />

  <rect
    x="${barX}"
    y="${y}"
    width="${barWidth.toFixed(1)}"
    height="10"
    rx="5"
    fill="${theme.accent}"
    opacity="${Math.max(0.45, 1 - index * 0.11)}"
  />
`;

    svg += text({
      x: 362,
      y: y + 10,
      value: `${percentage.toFixed(1)}%`,
      fill: theme.muted,
      size: 11,
      anchor: "end",
    });
  });

  svg += cardEnd();

  return svg;
}

for (const [name, theme] of Object.entries(themes)) {
  const directory = `generated/${name}`;

  await mkdir(directory, { recursive: true });

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
