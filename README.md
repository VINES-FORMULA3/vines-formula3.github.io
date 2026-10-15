# FORMULA3 website

Project website for **FORMULA3: Framework for Optimal Resource Management Using Generalizable AI in FR3 Dynamic Programmable Wireless Environments**, an NSF–Research Council of Finland VINES project (NSF Award Nos. 2549087 and 2549088; Research Council of Finland Decision Nos. 380594 and 380600).

Live site: https://vines-formula3.github.io/

The site is built with Jekyll by GitHub Pages straight from the `main` branch. There is no build step to run: commit to `main` and the site updates within a minute or two.

## Updating content

Most updates mean editing one file. You can do it in the GitHub web editor.

| To update… | Edit | Notes |
|---|---|---|
| News | Add a file to `_news/`, named `YYYY-MM-DD-short-title.md` | Copy an existing post. `summary:` in the front matter is shown in lists. |
| Publications | `_data/publications.yml` → `project:` | Newest first. Links are optional (`doi`, `arxiv`, `pdf`, `code`, `data`). |
| People | `_data/team.yml` | Add postdocs and students under `members:`. Photos go in `assets/img/team/` (square, ≥ 400 px). |
| Datasets | `_data/datasets.yml` | Set `status: released` and fill in `link` (plus `doi` and `license`) when a dataset goes public. |
| Timeline | `_data/timeline.yml` | `span: [start, end]` in half-year periods 1–6. |
| Partners | `_data/partners.yml` | Logos in `assets/img/logos/`. |
| Hero animation assumptions | `assets/js/pwe-model.js` → `BANDS` (bandwidth, blockage loss per person, surface losses); in `assets/js/pwe-sim.js`: `TARGET` (2 Gbps line), `SEED` and `DURATION` (the fixed 2-minute scenario) | Illustrative model, not measurements. The results section and comparison table are computed from this scenario on page load. |
| Funding text | `_config.yml` → `awards` (NSF) and `rcf_awards` (Research Council of Finland), plus `_includes/footer.html` | |

Longer pages (`research.html`, `outreach.html`, `index.html`) are HTML with a small front-matter header.

## Structure

```
_config.yml          site settings, navigation, award numbers
_data/               team, publications, datasets, timeline, partners (YAML)
_news/               news posts (Markdown)
_layouts/            default, page, news
_includes/           header, footer, and reusable blocks (Gantt chart, person card, …)
assets/css/site.css  all styles (light and dark mode)
assets/js/           site.js (mobile menu), pwe-model.js (hero link model), pwe-sim.js (hero animation and controls)
index.html, research.html, team.html, publications.html, datasets.html, outreach.html, news.html
```

## Previewing locally (optional)

Requires Ruby 3.x and Bundler.

```bash
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000/.
