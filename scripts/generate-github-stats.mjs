import { mkdir, writeFile } from "node:fs/promises";

const USERNAME = "Uzy777";

const statsToken = process.env.PROFILE_STATS_TOKEN;
const reposToken = process.env.SUMMARY_GITHUB_TOKEN;

if (!statsToken) {
  throw new Error("PROFILE_STATS_TOKEN is not available.");
}

if (!reposToken) {
  throw new Error("SUMMARY_GITHUB_TOKEN is not available.");
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
// GitHub GraphQL helper
// ---------------------------------------------------------

async function graphql(token, query, variables = {}) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${USERNAME}-profile-stats`,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API returned ${response.status}: ${await response.text()}`
    );
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(
      JSON.stringify(payload.errors, null, 2)
    );
  }

  return payload.data;
}

// ---------------------------------------------------------
// Contribution query
//
// PROFILE_STATS_TOKEN handles contribution statistics.
// ---------------------------------------------------------

const statsQuery = `
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
    }
  }
`;

// ---------------------------------------------------------
// Recent repository query
//
// SUMMARY_GITHUB_TOKEN handles repository metadata.
// Private names are read temporarily but are never written
// into the generated public SVG.
// ---------------------------------------------------------

const recentWorkQuery = `
  query {
    viewer {
      login

      repositories(
        first: 100
        ownerAffiliations: [OWNER]
        isFork: false
        orderBy: {
          field: PUSHED_AT
          direction: DESC
        }
      ) {
        totalCount

        nodes {
          name
          isPrivate
          pushedAt
        }
      }
    }
  }
`;

// ---------------------------------------------------------
// Fetch GitHub data
// ---------------------------------------------------------

const [
  statsData,
  recentWorkData,
] = await Promise.all([
  graphql(
    statsToken,
    statsQuery,
    {
      login: USERNAME,
      recentFrom: recentFrom.toISOString(),
      yearFrom: yearFrom.toISOString(),
      to,
    }
  ),

  graphql(
    reposToken,
    recentWorkQuery
  ),
]);

const user = statsData?.user;
const viewer = recentWorkData?.viewer;

if (!user) {
  throw new Error(
    `Could not find GitHub user ${USERNAME}.`
  );
}

if (!viewer) {
  throw new Error(
    "Could not fetch repositories using SUMMARY_GITHUB_TOKEN."
  );
}

if (
  viewer.login.toLowerCase() !==
  USERNAME.toLowerCase()
) {
  throw new Error(
    `SUMMARY_GITHUB_TOKEN belongs to ${viewer.login}, not ${USERNAME}.`
  );
}

const recentCalendar =
  user.recent.contributionCalendar;

const yearCalendar =
  user.year.contributionCalendar;

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
  return new Intl.NumberFormat(
    "en-GB",
    {
      notation: "compact",
      maximumFractionDigits: 1,
    }
  ).format(value);
}

function flattenCalendar(
  calendar,
  fromDate
) {
  const minimumDate =
    fromDate
      .toISOString()
      .slice(0, 10);

  return calendar.weeks
    .flatMap(
      (week) =>
        week.contributionDays
    )
    .filter(
      (day) =>
        day.date >= minimumDate
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        )
    );
}

function longestStreak(days) {
  let longest = 0;
  let current = 0;

  for (const day of days) {
    if (
      day.contributionCount > 0
    ) {
      current += 1;

      longest =
        Math.max(
          longest,
          current
        );
    } else {
      current = 0;
    }
  }

  return longest;
}

function niceAxisMaximum(
  maxValue
) {
  if (maxValue <= 4) {
    return {
      step: 1,
      maximum: 4,
    };
  }

  const roughStep =
    maxValue / 4;

  const magnitude =
    10 **
    Math.floor(
      Math.log10(
        roughStep
      )
    );

  const fraction =
    roughStep / magnitude;

  let niceFraction;

  if (fraction <= 1) {
    niceFraction = 1;
  } else if (
    fraction <= 2
  ) {
    niceFraction = 2;
  } else if (
    fraction <= 5
  ) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  const step =
    niceFraction *
    magnitude;

  return {
    step,

    maximum:
      Math.ceil(
        maxValue / step
      ) * step,
  };
}

function daysAgoLabel(
  isoDate
) {
  const then =
    new Date(isoDate);

  const diffMs =
    now.getTime() -
    then.getTime();

  const days =
    Math.max(
      0,
      Math.floor(
        diffMs /
        86_400_000
      )
    );

  if (days === 0) {
    return "today";
  }

  if (days === 1) {
    return "1d ago";
  }

  if (days < 7) {
    return `${days}d ago`;
  }

  const weeks =
    Math.floor(
      days / 7
    );

  if (weeks < 5) {
    return `${weeks}w ago`;
  }

  const months =
    Math.floor(
      days / 30
    );

  if (months < 12) {
    return `${months}mo ago`;
  }

  const years =
    Math.floor(
      days / 365
    );

  return `${years}y ago`;
}

function truncate(
  value,
  maxLength
) {
  if (
    value.length <=
    maxLength
  ) {
    return value;
  }

  return (
    value.slice(
      0,
      maxLength - 1
    ) + "…"
  );
}

function cardStart(
  width,
  height,
  theme,
  title
) {
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
// Themes
// ---------------------------------------------------------

const themes = {
  dark: {
    background: "#0D1117",
    border: "#30363D",
    text: "#F0F6FC",
    muted: "#8B949E",
    accent: "#539BF5",
    grid: "#21262D",
  },

  light: {
    background: "#FFFFFF",
    border: "#D0D7DE",
    text: "#1F2328",
    muted: "#656D76",
    accent: "#0969DA",
    grid: "#EAEEF2",
  },
};

// ---------------------------------------------------------
// Contribution data
// ---------------------------------------------------------

const recentContributionMap =
  new Map(
    flattenCalendar(
      recentCalendar,
      recentFrom
    ).map(
      (day) => [
        day.date,
        day.contributionCount,
      ]
    )
  );

const recentDays = [];

const today =
  new Date();

today.setUTCHours(
  0,
  0,
  0,
  0
);

for (
  let offset = 29;
  offset >= 0;
  offset--
) {
  const date =
    new Date(today);

  date.setUTCDate(
    today.getUTCDate() -
    offset
  );

  const dateString =
    date
      .toISOString()
      .slice(0, 10);

  recentDays.push({
    date: dateString,

    contributionCount:
      recentContributionMap
        .get(dateString) ??
      0,
  });
}

const yearDays =
  flattenCalendar(
    yearCalendar,
    yearFrom
  );

const recentTotal =
  recentDays.reduce(
    (sum, day) =>
      sum +
      day.contributionCount,
    0
  );

const activeDays =
  yearDays.filter(
    (day) =>
      day.contributionCount >
      0
  ).length;

const longestActiveStreak =
  longestStreak(
    yearDays
  );

// ---------------------------------------------------------
// Recent work
// ---------------------------------------------------------

const recentRepos =
  viewer.repositories.nodes
    .filter(
      (repo) =>
        repo.name !==
        USERNAME
    )
    .filter(
      (repo) =>
        repo.pushedAt
    )
    .slice(0, 4);

// ---------------------------------------------------------
// Activity SVG
// ---------------------------------------------------------

function createActivitySvg(
  theme
) {
  const width = 800;
  const height = 300;

  const chart = {
    left: 64,
    right: 770,
    top: 92,
    bottom: 230,
  };

  const chartWidth =
    chart.right -
    chart.left;

  const chartHeight =
    chart.bottom -
    chart.top;

  const values =
    recentDays.map(
      (day) =>
        day.contributionCount
    );

  const maximumValue =
    Math.max(
      ...values,
      0
    );

  const axis =
    niceAxisMaximum(
      maximumValue
    );

  const points =
    recentDays.map(
      (day, index) => {
        const x =
          chart.left +
          (
            index /
            Math.max(
              recentDays.length -
              1,
              1
            )
          ) *
          chartWidth;

        const y =
          chart.bottom -
          (
            day.contributionCount /
            axis.maximum
          ) *
          chartHeight;

        return {
          x,
          y,
          dayNumber:
            index + 1,
        };
      }
    );

  const linePoints =
    points
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

  let svg =
    cardStart(
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
    value:
      "Contribution activity",
    fill: theme.text,
    size: 18,
    weight: 600,
  });

  svg += text({
    x: 28,
    y: 61,
    value:
      "Last 30 days · Day 30 is today",
    fill: theme.muted,
    size: 12,
  });

  svg += text({
    x: 772,
    y: 39,
    value:
      `${compact(recentTotal)} contributions`,
    fill: theme.accent,
    size: 14,
    weight: 600,
    anchor: "end",
  });

  // Y-axis and grid
  for (
    let value = 0;
    value <= axis.maximum;
    value += axis.step
  ) {
    const y =
      chart.bottom -
      (
        value /
        axis.maximum
      ) *
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
      x:
        chart.left -
        12,
      y: y + 4,
      value,
      fill: theme.muted,
      size: 10,
      anchor: "end",
    });
  }

  // Axes
  svg += `
    <line
      x1="${chart.left}"
      y1="${chart.top}"
      x2="${chart.left}"
      y2="${chart.bottom}"
      stroke="${theme.border}"
      stroke-width="1"
    />

    <line
      x1="${chart.left}"
      y1="${chart.bottom}"
      x2="${chart.right}"
      y2="${chart.bottom}"
      stroke="${theme.border}"
      stroke-width="1"
    />
  `;

  // Area and line
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

  // Day points and X-axis labels 1 → 30
  points.forEach(
    ({
      x,
      y,
      dayNumber,
    }) => {
      svg += `
        <circle
          cx="${x}"
          cy="${y}"
          r="2"
          fill="${theme.accent}"
        />

        <line
          x1="${x}"
          y1="${chart.bottom}"
          x2="${x}"
          y2="${chart.bottom + 4}"
          stroke="${theme.border}"
          stroke-width="1"
        />
      `;

      svg += text({
        x,
        y: 249,
        value: dayNumber,
        fill:
          theme.muted,
        size: 8,
        anchor: "middle",
      });
    }
  );

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

  svg += text({
    x:
      chart.left +
      chartWidth / 2,
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

function createStatsSvg(
  theme
) {
  const width = 390;
  const height = 240;

  const metrics = [
    {
      label:
        "Contributions",

      value:
        compact(
          yearCalendar
            .totalContributions
        ),
    },

    {
      label:
        "Commits",

      value:
        compact(
          user.year
            .totalCommitContributions
        ),
    },

    {
      label:
        "Active days",

      value:
        activeDays,
    },

    {
      label:
        "Longest streak",

      value:
        `${longestActiveStreak}d`,
    },
  ];

  let svg =
    cardStart(
      width,
      height,
      theme,
      "GitHub statistics"
    );

  svg += text({
    x: 28,
    y: 38,
    value:
      "GitHub stats",
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
    (
      metric,
      index
    ) => {
      const column =
        index % 2;

      const row =
        Math.floor(
          index / 2
        );

      const x =
        column === 0
          ? 28
          : 210;

      const y =
        111 +
        row * 72;

      svg += text({
        x,
        y,
        value:
          metric.value,
        fill:
          theme.accent,
        size: 25,
        weight: 600,
      });

      svg += text({
        x,
        y: y + 23,
        value:
          metric.label,
        fill:
          theme.muted,
        size: 12,
      });
    }
  );

  svg += cardEnd();

  return svg;
}

// ---------------------------------------------------------
// Recent work SVG
// ---------------------------------------------------------

function createRecentWorkSvg(
  theme
) {
  const width = 390;
  const height = 240;

  let svg =
    cardStart(
      width,
      height,
      theme,
      "Recent work"
    );

  svg += text({
    x: 28,
    y: 38,
    value:
      "Recent work",
    fill:
      theme.text,
    size: 18,
    weight: 600,
  });

  svg += text({
    x: 28,
    y: 61,
    value:
      "Recently updated repositories · private names hidden",
    fill:
      theme.muted,
    size: 11,
  });

  const rowStart = 98;
  const rowSpacing = 33;

  recentRepos.forEach(
    (repo, index) => {
      const y =
        rowStart +
        index *
        rowSpacing;

      if (index > 0) {
        svg += `
          <line
            x1="28"
            y1="${y - 18}"
            x2="362"
            y2="${y - 18}"
            stroke="${theme.grid}"
            stroke-width="1"
          />
        `;
      }

      if (repo.isPrivate) {
        // Small lock icon.
        svg += `
          <rect
            x="29"
            y="${y - 10}"
            width="10"
            height="8"
            rx="2"
            fill="none"
            stroke="${theme.muted}"
            stroke-width="1.4"
          />

          <path
            d="M31 ${y - 10} V${y - 13} A3 3 0 0 1 37 ${y - 13} V${y - 10}"
            fill="none"
            stroke="${theme.muted}"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        `;
      } else {
        // Public repository indicator.
        svg += `
          <circle
            cx="34"
            cy="${y - 6}"
            r="4"
            fill="${theme.accent}"
          />
        `;
      }

      svg += text({
        x: 48,
        y,

        value:
          repo.isPrivate
            ? "Private repository"
            : truncate(
                repo.name,
                25
              ),

        fill:
          theme.text,

        size: 13,
        weight: 600,
      });

      svg += text({
        x: 362,
        y,

        value:
          daysAgoLabel(
            repo.pushedAt
          ),

        fill:
          theme.muted,

        size: 11,
        anchor: "end",
      });
    }
  );

  if (
    recentRepos.length ===
    0
  ) {
    svg += text({
      x: 195,
      y: 140,

      value:
        "No recent repository activity",

      fill:
        theme.muted,

      size: 12,
      anchor: "middle",
    });
  }

  svg += text({
    x: 28,
    y: 220,

    value:
      "Private repository names are never written to this SVG",

    fill:
      theme.muted,

    size: 10,
  });

  svg += cardEnd();

  return svg;
}

// ---------------------------------------------------------
// Generate SVG files
// ---------------------------------------------------------

for (
  const [
    themeName,
    theme,
  ]
  of
  Object.entries(
    themes
  )
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
      createActivitySvg(
        theme
      ),
      "utf8"
    ),

    writeFile(
      `${directory}/stats.svg`,
      createStatsSvg(
        theme
      ),
      "utf8"
    ),

    writeFile(
      `${directory}/recent-work.svg`,
      createRecentWorkSvg(
        theme
      ),
      "utf8"
    ),
  ]);
}

console.log(
  "GitHub SVG stats generated successfully."
);
