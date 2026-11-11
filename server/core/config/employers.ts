/**
 * The ATS allowlist: which companies' own hiring systems we read directly.
 *
 * Every other source in the registry is a *board* — an aggregator an employer pays to carry a copy
 * of a posting. An ATS is where the posting is written, so this file reaches the origin: full
 * descriptions, no paid placements, and postings that were never distributed to a board at all.
 *
 * Coverage is exactly this list — these endpoints are per-employer and have no search — so adding a
 * company is a one-line edit here and nothing else. That is the same hand-checked-allowlist
 * principle as `registry.ts`, and the reason there is no discovery code.
 */

export type Employer = {
  /**
   * The display name we store. Deliberately not taken from the feed: Greenhouse's board response has
   * no company field at all, and the others carry the ATS tenant's spelling rather than the legal name.
   */
  company: string
  platform: 'greenhouse' | 'lever' | 'ashby' | 'recruitee' | 'workable' | 'workday' | 'wordpress' | 'onlyfy'
  token: string
}

/**
 * Employers whose Swiss presence is remote-only (GitLab, Datadog, Elastic, Grafana) are kept on
 * purpose: `Remote, Switzerland` in a multi-country location string is a real Swiss opening.
 *
 * Some entries currently have no Swiss posting (Esri, NavVis, …). They are watches: one request a
 * run, nothing stored until a Swiss req opens, at which point the Swiss filter admits it.
 */
export const employers: Employer[] = [
  { company: 'On AG', platform: 'greenhouse', token: 'onrunning' },
  { company: 'Proton AG', platform: 'greenhouse', token: 'proton' },
  { company: 'Speechify', platform: 'greenhouse', token: 'speechify' },
  { company: 'Auterion', platform: 'greenhouse', token: 'auterion' },
  { company: 'Scandit', platform: 'greenhouse', token: 'scandit' },
  { company: 'Databricks', platform: 'greenhouse', token: 'databricks' },
  { company: 'GetYourGuide', platform: 'greenhouse', token: 'getyourguide' },
  { company: 'Elastic', platform: 'greenhouse', token: 'elastic' },
  { company: 'Datadog', platform: 'greenhouse', token: 'datadog' },
  { company: 'MongoDB', platform: 'greenhouse', token: 'mongodb' },
  { company: 'Celonis', platform: 'greenhouse', token: 'celonis' },
  { company: 'Anthropic', platform: 'greenhouse', token: 'anthropic' },
  { company: 'Grafana Labs', platform: 'greenhouse', token: 'grafanalabs' },
  { company: 'GitLab', platform: 'greenhouse', token: 'gitlab' },
  { company: 'Inyova', platform: 'greenhouse', token: 'inyova' },
  { company: 'Anteris Technologies', platform: 'greenhouse', token: 'anteristech' },
  { company: 'WPP Media', platform: 'greenhouse', token: 'wppmedia' },
  { company: 'Alpha Financial Markets Consulting', platform: 'greenhouse', token: 'alphafmcroles' },
  { company: 'Zscaler', platform: 'greenhouse', token: 'zscaler' },
  { company: 'Inceptive', platform: 'greenhouse', token: 'inceptive' },
  { company: 'Commvault', platform: 'greenhouse', token: 'commvault' },
  { company: 'Esri', platform: 'greenhouse', token: 'esri' },
  { company: 'NavVis', platform: 'greenhouse', token: 'navvis' },
  { company: 'Divergent', platform: 'greenhouse', token: 'divergent' },
  { company: 'Formlabs', platform: 'greenhouse', token: 'formlabs' },

  { company: 'Sonar', platform: 'lever', token: 'sonarsource' },
  { company: 'ANYbotics', platform: 'lever', token: 'anybotics' },
  { company: 'Frontify', platform: 'lever', token: 'frontify' },
  { company: 'Zurich Instruments', platform: 'lever', token: 'zurichinstruments' },
  { company: 'Welo Global', platform: 'lever', token: 'weloglobal' },
  { company: 'Gravis Robotics', platform: 'lever', token: 'gravisrobotics' },
  { company: 'RIVR', platform: 'lever', token: 'rivr' },
  { company: 'Wingtra', platform: 'lever', token: 'wingtra-2' }, // `wingtra` is not theirs

  { company: 'DeepJudge', platform: 'ashby', token: 'deepjudge' },
  { company: 'Omnilex', platform: 'ashby', token: 'omnilex' },
  { company: 'Langfuse', platform: 'ashby', token: 'langfuse' },
  { company: 'OpenAI', platform: 'ashby', token: 'openai' },
  { company: 'Tandem Health', platform: 'ashby', token: 'tandem-health' },
  { company: 'Harmattan AI', platform: 'ashby', token: 'harmattan-ai' },
  { company: 'Neural Concept', platform: 'ashby', token: 'neuralconcept' },
  { company: 'Loki Robotics', platform: 'ashby', token: 'loki' },
  { company: 'Sereact', platform: 'ashby', token: 'sereact' },
  { company: 'BLP Digital', platform: 'ashby', token: 'blp-digital' },
  { company: 'Exclaim Robotics', platform: 'ashby', token: 'exclaim' },
  { company: 'Applied Intuition', platform: 'ashby', token: 'applied' },

  { company: 'SwissPeak Partners', platform: 'recruitee', token: 'swisspeakpartnersgmbh' },
  { company: 'Climeworks', platform: 'recruitee', token: 'climeworks' },
  { company: 'Imnoo', platform: 'recruitee', token: 'imnoo' },
  { company: 'Exeon Analytics', platform: 'recruitee', token: 'exeon' },
  { company: 'EthonAI', platform: 'recruitee', token: 'ethonai' },
  { company: 'SkyCell', platform: 'recruitee', token: 'skycellag' },

  { company: 'Visium', platform: 'workable', token: 'visium' },
  { company: 'Crypto Finance', platform: 'workable', token: 'crypto-finance' },
  { company: 'Flexion Robotics', platform: 'workable', token: 'flexion-robotics' },
  { company: 'IMTF', platform: 'workable', token: 'imtf' },
  { company: 'LatticeFlow AI', platform: 'workable', token: 'latticeflow' },
  { company: 'Unit8', platform: 'workable', token: 'unit8' },
  { company: 'D ONE', platform: 'workable', token: 'd-one' },
  { company: 'Flyability', platform: 'workable', token: 'flyability' },
  { company: 'Distalmotion', platform: 'workable', token: 'distalmotion' },
  { company: 'Rapyuta Robotics', platform: 'workable', token: 'rapyuta-robotics' },

  // Workday: token is `{tenant}.wdN/{site}`. robots.txt is per tenant, checked per entry.
  // ABB is left out: its robots.txt disallows /External_Career_Page/.
  // Materialise: robots.txt disallows only /refreshFacet/; no Swiss location facet, so one POST a run.
  { company: 'Materialise', platform: 'workday', token: 'materialise.wd103/Materialise_Jobs' },

  // WordPress + WP Job Manager: token is the host. robots.txt disallows /*? and asks Crawl-delay: 3;
  // /wp-json/ is allowed, and one request per run sits under the delay.
  { company: 'LAYERED', platform: 'wordpress', token: 'layered.ch' },

  // onlyfy: token is the subdomain of {token}.onlyfy.jobs. robots.txt asks Crawl-delay: 1 and
  // disallows only /recruiter/ and /change_language.
  { company: 'Leica Geosystems', platform: 'onlyfy', token: 'leica-geosystems-ag' },
  { company: 'Hexagon Robotics', platform: 'onlyfy', token: 'hexagon-robotics' },
]

/**
 * ## Finding more employers
 *
 * Greenhouse publishes no directory of boards, so a token has to be found rather than looked up:
 *
 * 1. **My Greenhouse, by hand.** `my.greenhouse.io/jobs/search?location=Zurich` is Greenhouse's own
 *    cross-board index and every result sits at `my.greenhouse.io/jobs/{token}`. Browsing it by hand
 *    is intended use; automating it is barred (User Agreement 2(z) forbids "spiders, robots,
 *    crawlers"), which is why there is no code for it.
 * 2. **Search-engine site: queries** — `site:job-boards.greenhouse.io Zurich Switzerland`, varied by
 *    city and role word. The index goes stale, so a hit is a lead, never an entry.
 * 3. **Slugifying company names and probing** — cheap but near-useless: companies that pay Swiss
 *    job boards are, almost by definition, not the ones on Greenhouse.
 *
 * Before building an adapter for a company's own careers page, check it for an ATS embed
 * (`#grnhse_app`, `?gh_jid=`): it is often a one-line entry here.
 *
 * To enter a lead: fetch the board once and add it only if it answers 200 *and* holds at least one
 * Swiss posting — a board with none costs a request every run and returns nothing. A named employer
 * asked for by hand is the exception: there the empty board *is* the thing being watched.
 */
