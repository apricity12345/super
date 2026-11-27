// 纯函数渲染层：只根据传入的数据返回 HTML，不访问 DOM 或浏览器 API。

const EXTERNAL_LINK_ATTRIBUTES = ' target="_blank" rel="noopener noreferrer"';

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
}

export function isExternalUrl(url) {
  return /^https?:\/\//i.test(String(url));
}

export function externalLinkAttributes(url) {
  return isExternalUrl(url) ? EXTERNAL_LINK_ATTRIBUTES : "";
}

export function resolveTheme(storedTheme, systemPrefersDark) {
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return systemPrefersDark ? "dark" : "light";
}

export function toggleTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}

export function renderThemeToggle() {
  return `<button class="theme-toggle" type="button" data-theme-toggle aria-label="切换主题" aria-pressed="false" title="切换主题">
        <svg class="theme-icon theme-icon--sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>
        </svg>
        <svg class="theme-icon theme-icon--moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M20.4 14.1A8.5 8.5 0 0 1 9.9 3.6a8.5 8.5 0 1 0 10.5 10.5Z"></path>
        </svg>
      </button>`;
}

export function renderHero(profile) {
  return `<header class="hero">
        <div class="avatar" aria-hidden="true">${escapeHtml(profile.avatarInitial)}</div>
        <p class="hero-kicker">个人主页</p>
        <h1 class="hero-name">${escapeHtml(profile.name)}</h1>
        <p class="hero-tagline">${escapeHtml(profile.tagline)}</p>
      </header>`;
}

function renderSection({ id, title, body, bodyClass = "" }) {
  const bodyClassName = bodyClass ? ` ${bodyClass}` : "";
  return `<section class="section" id="${id}" aria-labelledby="${id}-title">
        <h2 class="section-title" id="${id}-title">${escapeHtml(title)}</h2>
        <div class="section-body${bodyClassName}">${body}</div>
      </section>`;
}

export function renderAbout(profile) {
  const paragraphs = profile.about
    .map((sentence) => `<p>${escapeHtml(sentence)}</p>`)
    .join("\n          ");
  return renderSection({ id: "about", title: "关于我", body: paragraphs, bodyClass: "prose" });
}

export function renderSkills(profile) {
  const groups = profile.skills
    .map(
      (group) => `<div class="skill-group">
            <h3 class="skill-title">${escapeHtml(group.title)}</h3>
            <ul class="tag-list">
              ${group.items.map((item) => `<li class="tag">${escapeHtml(item)}</li>`).join("\n              ")}
            </ul>
          </div>`,
    )
    .join("\n          ");
  return renderSection({ id: "skills", title: "技能", body: groups, bodyClass: "skills" });
}

export function renderProjectCard(project) {
  return `<article class="project-card">
            <h3 class="project-title">${escapeHtml(project.title)}</h3>
            <p class="project-description">${escapeHtml(project.description)}</p>
            <a class="project-link" href="${escapeHtml(project.url)}"${externalLinkAttributes(project.url)}>${escapeHtml(project.linkLabel)} <span aria-hidden="true">↗</span></a>
          </article>`;
}

export function renderProjects(profile) {
  const cards = profile.projects.map((project) => renderProjectCard(project)).join("\n          ");
  return renderSection({ id: "projects", title: "项目", body: cards, bodyClass: "project-grid" });
}

export function renderContact(profile) {
  const { github, email } = profile.contact;
  const body = `<ul class="contact-list">
            <li class="contact-item">
              <span class="contact-label">${escapeHtml(github.label)}</span>
              <a class="contact-link" href="${escapeHtml(github.url)}"${externalLinkAttributes(github.url)}>${escapeHtml(github.display)}</a>
            </li>
            <li class="contact-item">
              <span class="contact-label">${escapeHtml(email.label)}</span>
              <a class="contact-link" href="mailto:${escapeHtml(email.address)}">${escapeHtml(email.address)}</a>
            </li>
          </ul>`;
  return renderSection({ id: "contact", title: "联系方式", body });
}

export function renderFooter(profile, year) {
  const copyright = Number.isInteger(year)
    ? `© ${escapeHtml(String(year))} ${escapeHtml(profile.name)}`
    : `© ${escapeHtml(profile.name)}`;
  return `<footer class="footer">
        <p>${copyright}</p>
        <p>${escapeHtml(profile.footerNote)}</p>
      </footer>`;
}

export function renderPage(profile, { year } = {}) {
  return `<div class="page">
      ${renderThemeToggle()}
      ${renderHero(profile)}
      <main class="main" id="main-content">
        ${renderAbout(profile)}
        ${renderSkills(profile)}
        ${renderProjects(profile)}
        ${renderContact(profile)}
      </main>
      ${renderFooter(profile, year)}
    </div>`;
}
