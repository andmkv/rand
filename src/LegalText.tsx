// Reviewed Privacy Policy and Terms of Use for rand.smallhall.org (English originals).
// PolicyPage shows them inline when the server-configured version matches the version
// here; a different configured version falls back to the configured document link.
// Changing either text means bumping its version and PRIVACY_/TERMS_VERSION together.
export const privacyVersion = "privacy-2026-1";
export const termsVersion = "terms-2026-1";
const effective = "20 October 2026";
const operator = "Andrey Makeev (Smallhall)";
const support = "am@smallhall.net";
const Mail = () => <a href={`mailto:${support}`}>{support}</a>;

export function PrivacyText() {
  return (
    <article className="legal-text" lang="en">
      <p>
        Version: {privacyVersion}. Effective: {effective}.
      </p>
      <p>
        Randomize USR (rand.smallhall.org) is a small coding playground run by{" "}
        {operator}. We collect as little as we can: you can use the editor,
        examples and stories without an account, and we never sell data, show
        ads or use tracking analytics.
      </p>
      <h2>Who is responsible</h2>
      <p>
        {operator} is responsible for your data. Contact: <Mail />.
      </p>
      <h2>Using the site without an account</h2>
      <ul>
        <li>
          Your project, story progress and language choice stay in your
          browser's local storage. They are not sent to us unless you save to
          the cloud.
        </li>
        <li>
          The server sees your IP address to deliver pages. Our web server
          keeps no access logs for this site; its error logs, which can include
          the IP address of a failed request, are deleted after 14 days. Our
          application logs do not record IP addresses, page addresses or what
          you type.
        </li>
        <li>
          Your IP address is also used, in memory only, to limit how many
          requests or demo sessions one address can start.
        </li>
      </ul>
      <h2>If you create an account</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Why</th>
            <th>How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Email address</td>
            <td>Sign-in, verification, password reset, security notices</td>
            <td>Until you delete the account</td>
          </tr>
          <tr>
            <td>Display name</td>
            <td>Shown next to projects you publish</td>
            <td>Until you delete the account</td>
          </tr>
          <tr>
            <td>Password</td>
            <td>Sign-in; stored only as a one-way hash</td>
            <td>Until you delete the account</td>
          </tr>
          <tr>
            <td>
              Language preference, accepted policy versions and acceptance time
            </td>
            <td>Show the site in your language; record what you agreed to</td>
            <td>Until you delete the account</td>
          </tr>
          <tr>
            <td>
              Projects, titles, descriptions, saved versions and screen previews
            </td>
            <td>Cloud save, history and sharing you choose</td>
            <td>Until you delete them or the account</td>
          </tr>
          <tr>
            <td>
              Reports you send (reason and optional text up to 500 characters)
            </td>
            <td>Moderation</td>
            <td>See "Deleting your account"</td>
          </tr>
          <tr>
            <td>Session record</td>
            <td>Keep you signed in</td>
            <td>14 days or until you sign out</td>
          </tr>
        </tbody>
      </table>
      <p>
        Accounts are for adults aged 18 or older. We do not ask for your date
        of birth, phone number or postal address.
      </p>
      <h2>What other people can see</h2>
      <p>
        Projects are private by default. If you choose "unlisted", anyone with
        the link can view and run it. If you publish to the gallery, anyone can
        view it, run it and remix a copy, together with your display name. Your
        email address is never shown to other users. Please do not put personal
        information in project text.
      </p>
      <h2>Cookies and browser storage</h2>
      <p>
        We use two strictly necessary cookies: <code>randusr_session</code>{" "}
        (keeps you signed in) and <code>randusr_csrf</code> (protects forms from
        cross-site attacks). Demo mode uses <code>randusr_demo_session</code>.
        There are no advertising or analytics cookies, so no cookie banner is
        needed.
      </p>
      <h2>Demo mode</h2>
      <p>
        Demo sessions are kept only in server memory, never in our database,
        mail or backups. They end after 60 minutes of inactivity or 24 hours,
        and their links stop working when you sign out or the session expires.
      </p>
      <h2>Services we use</h2>
      <ul>
        <li>Hosting: Amazon Web Services Lightsail, in an EU region.</li>
        <li>
          Email delivery: Namecheap, from noreply@smallhall.net. It processes
          your email address and the message content.
        </li>
        <li>
          Fonts: the interface font Victor Mono is loaded from Google Fonts, so
          Google receives your IP address and browser details when a page
          loads. See{" "}
          <a href="https://policies.google.com/privacy" rel="noreferrer">
            Google's privacy policy
          </a>
          .
        </li>
      </ul>
      <p>
        We do not share your data with anyone else, except where the law
        requires it.
      </p>
      <h2>Moderation and security records</h2>
      <p>
        When someone reports a project, or an administrator takes action, we
        keep a private record of the report and the action. These records help
        us handle abuse and are visible only to administrators.
      </p>
      <h2>Backups</h2>
      <p>
        We make an access-restricted database backup on the same server daily
        and keep each one for 14 days. Deleted data can remain in a backup until
        it expires.
      </p>
      <h2>Your rights</h2>
      <ul>
        <li>
          Download your data: Account settings → Account data and deletion →
          Download account data.
        </li>
        <li>Delete your account: same page; you confirm with your password.</li>
        <li>
          Correct your data: change your display name and language in account
          settings; to change your email address, write to <Mail />.
        </li>
        <li>
          Ask a question, object or complain: write to <Mail />. If you live in
          the EU or UK, you can also complain to your data protection
          authority.
        </li>
      </ul>
      <h2>Deleting your account</h2>
      <p>
        Deletion removes your email, display name, password, sessions and
        preferences, and erases your projects and their saved versions. Copies
        that other people remixed from your published projects belong to them
        and stay. Reports and moderation records remain, with your identity
        removed; any free text in them may still contain information you typed.
        Backups expire within 14 days.
      </p>
      <h2>Children</h2>
      <p>
        Accounts are for adults aged 18 or older. Children use the editor,
        examples and stories without an account, with an adult nearby; nothing
        they do there is sent to us. If you believe a child created an account,
        write to <Mail /> and we will delete it.
      </p>
      <h2>Changes</h2>
      <p>
        If we change this policy, we will update the version and date above. If
        the change matters for existing accounts, we will tell you by email
        before it takes effect.
      </p>
    </article>
  );
}

export function TermsText() {
  return (
    <article className="legal-text" lang="en">
      <p>
        Version: {termsVersion}. Effective: {effective}.
      </p>
      <p>
        By creating an account on Randomize USR (rand.smallhall.org), run by{" "}
        {operator}, you confirm that you are 18 or older and agree to these
        terms. Using the site without an account needs no agreement beyond
        using it fairly.
      </p>
      <h2>The service</h2>
      <p>
        Randomize USR is a free coding playground. Programs run only in your
        browser; the server stores them as data and never executes them. We may
        change, pause or end any feature, or the whole service, at any time. We
        will try to give notice before shutting down so you can download your
        projects.
      </p>
      <h2>Accounts</h2>
      <ul>
        <li>
          Accounts are for adults aged 18 or older. Children can use the site
          without an account, with an adult nearby.
        </li>
        <li>
          Give a real email address you control, and keep your password to
          yourself. You are responsible for what happens under your account.
        </li>
        <li>
          One person, one account. Do not create accounts automatically or to
          get around a suspension.
        </li>
      </ul>
      <h2>Your projects</h2>
      <p>
        You keep ownership of the projects you create. To run the service, you
        give us permission to store, copy and display them as your sharing
        settings allow.
      </p>
      <p>
        When you publish a project to the gallery, you also let other users
        view, run and remix it, and keep their remixed copies even if you later
        unpublish or delete yours. Unlisted projects can be viewed and run by
        anyone with the link.
      </p>
      <h2>Rules</h2>
      <p>Do not publish or share:</p>
      <ul>
        <li>anything illegal, hateful, sexual, violent or harassing;</li>
        <li>personal information about anyone, including yourself;</li>
        <li>work you do not have the right to share;</li>
        <li>
          spam, malware, attempts to trick people, or anything that attacks the
          site or its users.
        </li>
      </ul>
      <p>
        Do not try to break into accounts or systems, overload the site, or
        scrape it.
      </p>
      <h2>Moderation</h2>
      <p>
        Anyone with an account can report a project. Administrators may
        unpublish projects, block links and suspend or delete accounts that
        break these rules, without notice when needed to protect others. If you
        think we got it wrong, write to <Mail />.
      </p>
      <h2>No warranty</h2>
      <p>
        The service is provided "as is" and "as available", free of charge,
        without any warranty. You use it at your own risk. Keep your own copies
        of important work: use Save file or Download account data.
      </p>
      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, {operator} is not liable for lost data,
        lost profits or indirect damages arising from the service. Nothing in
        these terms limits liability that cannot be limited by law, or your
        rights as a consumer.
      </p>
      <h2>Ending your account</h2>
      <p>
        You can delete your account at any time in account settings. We may
        close accounts that break these terms. The Privacy Policy explains what
        happens to your data.
      </p>
      <h2>Changes and law</h2>
      <p>
        We may update these terms; the version and date above will change, and
        we will tell account holders by email about important changes before
        they take effect. These terms are governed by the law of the country
        where the operator lives. If you live in the EU, you also keep the
        protection of the mandatory consumer law of your own country.
      </p>
      <h2>Contact</h2>
      <p>
        <Mail />
      </p>
    </article>
  );
}
