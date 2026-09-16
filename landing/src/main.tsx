import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, ChevronRight, Code2, Copy, ExternalLink, FileCode2, Github, Layers3, Link2, Lock, Menu, Monitor, MousePointer2, Play, RefreshCw, Ruler, Search, ShieldCheck, Smartphone, Sparkles, Tablet, X } from 'lucide-react';
import handDrag from '../assets/hand-drag.png';
import handTap from '../assets/hand-tap.png';
import architecture from '../assets/architecture.jpg';
import portfolioEdit from '../assets/portfolio-edit.png';
import portfolioSecond from '../assets/portfolio-second.png';
import portfolioThird from '../assets/portfolio-third.png';
import commentIllustration from '../assets/comment-illustration.png';

function CTA({ label = 'Join the waitlist', subtle = false }: { label?: string; subtle?: boolean }) {
  const [done, setDone] = useState(false);
  return <button className={`cta ${subtle ? 'cta--subtle' : ''} ${done ? 'is-done' : ''}`} onClick={() => setDone(true)}>
    <span>{done ? 'You’re on the list' : label}</span>{done ? <Check /> : <ArrowRight />}
  </button>;
}

const WAITLIST_ENDPOINT = 'https://firestore.googleapis.com/v1/projects/ai-last-mile/databases/(default)/documents/waitlist';
const WAITLIST_KEY = 'AIzaSyADi6OtFT5b4Tg1vSLtny1_STLnXHfuznY'; // public Firebase web key; access is governed by Firestore rules

/** Store one address in the `waitlist` collection. Resolves on success or when the address is already there. */
async function joinWaitlist(rawEmail: string, source: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const response = await fetch(`${WAITLIST_ENDPOINT}?documentId=${encodeURIComponent(email)}&key=${WAITLIST_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      email: { stringValue: email },
      source: { stringValue: source },
      createdAt: { timestampValue: new Date().toISOString() },
    } }),
  });
  if (response.ok || response.status === 409) return;
  throw new Error(`Waitlist write failed (${response.status})`);
}

function WaitlistForm({ source = 'hero' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'joined' | 'error'>('idle');
  const id = `${source}-email`;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || state === 'sending') return;
    setState('sending');
    try { await joinWaitlist(email, source); setState('joined'); }
    catch (error) { console.error(error); setState('error'); }
  };
  return <form className={`waitlist-form ${state === 'joined' ? 'is-joined' : ''}`} onSubmit={submit}>
    {state === 'joined' ? <div className="waitlist-success"><Check/><span>You’re on the list — we’ll keep you posted.</span></div> : <>
      <label htmlFor={id} className="sr-only">Email address</label>
      <input id={id} type="email" required autoComplete="email" placeholder="Enter your email" value={email} onChange={(event) => { setEmail(event.target.value); if (state === 'error') setState('idle'); }} disabled={state === 'sending'} />
      <button type="submit" disabled={state === 'sending'}><span>{state === 'sending' ? 'Joining…' : state === 'error' ? 'Try again' : 'Join the waitlist'}</span><ArrowRight/></button>
    </>}
  </form>;
}

function LogoMark() {
  return <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="lg-px" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2386f5"/><stop offset="1" stopColor="#0655c9"/></linearGradient>
      <linearGradient id="lg-pk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff8a70"/><stop offset="1" stopColor="#f5506b"/></linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#lg-px)"/>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="3 2.2"/>
    <path d="M16.5 15.5 L29.5 21.2 L23.6 23.2 L21.4 29.2 Z" fill="url(#lg-pk)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/>
  </svg>;
}
function Logo() { return <a className="logo" href="#top" aria-label="Pixel Poke home"><LogoMark/><span>Pixel<b>Poke</b></span></a>; }

function Navbar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <header className="navbar">
    <Logo/>
    <nav className={`navlinks ${open ? 'is-open' : ''}`}>
      <a href="#how" onClick={close}>How it works</a>
      <a href="#features" onClick={close}>Features</a>
      <a href="#privacy" onClick={close}>Privacy</a>
      <a href="https://github.com/Itamardesign/Ai-Design-Last-Mile" onClick={close}><Github/> GitHub</a>
      <a className="nav-cta" href="#waitlist" onClick={close}>Join the waitlist <ArrowRight/></a>
    </nav>
    <button className="menu" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? <X/> : <Menu/>}</button>
  </header>;
}

function Selection({ children, className = '' }: React.PropsWithChildren<{className?: string}>) {
  return <div className={`selection ${className}`}><b className="pin">1</b>{children}<i/><i/><i/><i/><span className="measure">320px</span></div>;
}

function SiteMock({ variant = 'hero' }: { variant?: 'hero' | 'build' | 'modern' }) {
  const titles = { hero: <>Better tools<br/>for <em>bolder</em> ideas</>, build: <>Build better<br/>products, <em>faster.</em></>, modern: <>Modern spaces<br/>for modern <em>teams.</em></> };
  return <div className={`site-mock site-mock--${variant}`}>
    <div className="browserbar"><span className="traffic red"></span><span className="traffic yellow"></span><span className="traffic green"></span><div className="address">▣ &nbsp; www.example.com</div></div>
    <div className="site-nav"><span className="mark"><i></i><i></i></span><div>Products &nbsp;&nbsp;&nbsp; Solutions &nbsp;&nbsp;&nbsp; Resources</div><Search/><Menu/></div>
    <div className="site-content">
      <Selection><h3>{titles[variant]}</h3></Selection>
      <p>Build, iterate, and ship faster with tools<br/>designed for modern teams.</p>
      <button>Get started <ArrowRight/></button>
      <img src={architecture} alt="Modern white architectural building" />
    </div>
  </div>;
}

function InspectorCapture({ src, alt, mode }: { src: string; alt: string; mode: 'edit' | 'comments' }) {
  return <div className={`inspector-capture inspector-capture--${mode}`}>
    <div className="capture-chrome"><span></span><span></span><span></span><div>Pixel Poke · Live page session</div></div>
    <img src={src} alt={alt} />
    <div className="capture-shine" aria-hidden="true"></div>
  </div>;
}

function Hero() {
  return <section className="hero" id="top">
    <div className="hero-copy reveal">
      <p className="eyebrow">The live-page design inspector</p>
      <h1>Poke any UI.<br/>Hand off <em>real</em> CSS</h1>
      <p className="lede"><strong>Pixel Poke</strong> lets you adjust any loaded webpage by eye, then export CSS and notes. It changes nothing in the site or its files.</p>
      <WaitlistForm/>
      <p className="micro">Be first to select, tune, and hand off live UI directly from Chrome.</p>
      <div className="hairline"></div>
      <p className="fine">Works on pages you own, competitors’ pages, staging, production, and pages without source access.</p>
    </div>
    <div className="hero-art art-scene" data-parallax=".11">
      <InspectorCapture src={portfolioEdit} mode="edit" alt="Pixel Poke editing a selected portfolio section in its live canvas" />
      <img className="hand hand--hero" src={handDrag} alt="Illustrated hand adjusting a selected element" />
      <span className="floating-chip">391.7 × 609.6</span>
    </div>
  </section>;
}

function Story() {
  return <section className="story section" id="about">
    <div className="story-art art-scene" data-parallax="-.06">
      <InspectorCapture src={portfolioSecond} mode="comments" alt="Pixel Poke comments panel open on a portfolio hero with pinned notes" />
      <img className="comment-illustration" src={commentIllustration} alt="Illustrated comment card pinned above the portfolio portrait" />
    </div>
    <div className="story-copy reveal"><p className="eyebrow">Shared pages.</p><h2>Turn live feedback into <em>something buildable.</em></h2><p>A designer spots an issue, opens DevTools, takes a screenshot, then writes “can we make this 16px?” A developer must work it out again. Pixel Poke keeps the adjustment, the reason, and the result together in one working session.</p><CTA/><p className="fine">For product designers and frontend developers sharing a page, but not necessarily its codebase.</p></div>
  </section>;
}

function StylePanel() { return <div className="tool-panel style-panel"><h4><Sparkles/> Style</h4><label>Font <span>Fraunces⌄</span></label><div className="panel-grid"><label>Size <span>64px</span></label><label>Weight <span>700⌄</span></label></div><label>Color <span><b className="swatch"></b>#10233B</span></label><h5>Layout</h5><div className="panel-grid"><label>Width <span>320px</span></label><label>Height <span>72px</span></label></div><button><RefreshCw/> Update element</button></div>; }
function ExportPanel() { return <div className="tool-panel export-panel"><h4><Code2/> Export</h4><pre>{`.hero-title {\n  font-family: Fraunces, serif;\n  font-size: 64px;\n  font-weight: 700;\n  color: #10233B;\n  width: 320px;\n}`}</pre><h5>Handoff details</h5><p>◉ Token: text-heading-1</p><p>◉ Note: Updated headline style</p><p>◉ A11y: Good contrast (7.2:1)</p><button><Copy/> Copy CSS</button></div>; }

function PortfolioWorkflowShot() { return <div className="portfolio-workflow-shot">
  <div className="browserbar"><span className="traffic red"></span><span className="traffic yellow"></span><span className="traffic green"></span><div className="address">▣ &nbsp; itamar-katan-protfolio.vercel.app</div></div>
  <img src={portfolioThird} alt="About section of the portfolio: I live where the world learns" />
</div>; }

function Steps() { return <section className="steps section" id="how"><div className="steps-inner">
    <h2 className="reveal">Three moves from<br/>page to handoff</h2>
    <div className="step-row reveal">
      <article><b>1</b><div><h3>Inspect</h3><p>Open the toolbar, then click an element. A selection frame locks on and the panel opens beside the page.</p></div></article>
      <article><b>2</b><div><h3>Tune</h3><p>Drag, resize, recolour, or retype in place. Guides, measurements, snapping, and undo keep it precise.</p></div></article>
      <article><b>3</b><div><h3>Hand off</h3><p>Export one rule for each changed element, with notes, token names, and accessibility findings attached.</p></div></article>
    </div>
    <div className="workflow-art reveal"><PortfolioWorkflowShot/><StylePanel/><ExportPanel/></div>
  </div></section>; }

const features = [
  [<Monitor/>, 'Device frames', 'Load phone, tablet, and desktop widths in the panel, rotate them, and adjust the framed element directly.'],
  [<MousePointer2/>, 'State previews', 'Detect hover, active, focus, and disabled styles from the site’s CSS and preview each component state.'],
  [<Link2/>, 'Connected tokens', 'Bind values to your system, audit the page, and apply one change across component variants.'],
  [<ShieldCheck/>, 'Important overrides', 'When a page uses !important, the preview outranks it and exported CSS keeps the same declaration.'],
];

function DeviceIllustration() { return <div className="devices art-scene" data-parallax=".045"><div className="laptop"><div className="device-top"></div><div className="skeleton"><i/><i/><i/><i/></div><Selection><button></button></Selection></div><div className="tablet"><div/><i/><i/><button/></div><div className="phone"><div/><i/><i/><button/></div><div className="device-switch"><Monitor/><Tablet/><Smartphone/><span><RefreshCw/> States</span><span><Layers3/> Tokens</span><span><Code2/> Overrides</span></div><img className="hand hand--device" src={handTap} alt="Illustrated hand tapping a selected button" /></div>; }

function Features() { return <section className="features section" id="features"><div className="features-copy reveal"><h2>Handle responsive<br/>components, tokens,<br/>and <em>stubborn styles</em></h2><div className="feature-list">{features.map(([icon,title,copy]) => <article key={String(title)}><b>{icon}</b><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div><p className="token-note"><Layers3/> Use plain JSON, DTCG or Style Dictionary, Tokens Studio, Tailwind config, unlabelled exports, or a URL that refreshes from your build.</p></div><DeviceIllustration/></section>; }

function PrivacyTab({ state }: { state: 'edited' | 'original' }) {
  const edited = state === 'edited';
  return <div className={`ptab ptab--${state}`}>
    <div className="ptab-chrome">
      <span className="traffic red"></span><span className="traffic yellow"></span><span className="traffic green"></span>
      <div className="ptab-tab"><b/>{edited ? 'Your tab · 3 live edits' : 'Your tab · reloaded'}</div>
    </div>
    <div className="ptab-page">
      <div className="ptab-nav"><i/><em/><em/><em/></div>
      <div className="ptab-hero">
        <div className="ptab-copy">
          <h5 className={edited ? 'is-edited' : ''}>Ship the<br/>thing.</h5>
          <i/><i/>
          <button className={edited ? 'is-edited' : ''}></button>
          {edited && <span className="ptab-pin">1</span>}
          {edited && <span className="ptab-measure">24px</span>}
        </div>
        <div className={`ptab-img ${edited ? 'is-edited' : ''}`}></div>
      </div>
    </div>
    <span className={`ptab-badge ${edited ? 'is-edited' : 'is-original'}`}>{edited ? <><Sparkles/> Changes exist only here</> : <><Check/> Original page, untouched</>}</span>
  </div>;
}
function PrivacyFiles() {
  return <div className="pfiles">
    <div className="pfiles-head"><Lock/> Site files <b>0 written</b></div>
    {['index.html','styles.css','app.js'].map((f) => <div key={f} className="pfiles-row"><FileCode2/><span>{f}</span><em>unchanged</em></div>)}
  </div>;
}
function Privacy() { return <section className="privacy section" id="privacy"><div className="privacy-copy reveal"><h2>The page remains<br/>exactly where it was</h2><p>Changes exist only in your current tab. Reload it and the page returns to its original state. You can skip sign-in and keep everything on your machine, or sign in with Google to mirror notes, unfinished adjustments, and saved handoffs between computers.</p><p className="privacy-fine">No site files or page content are written or modified. &nbsp;·&nbsp; Without sign-in, your work stays on your machine.</p><a href="/privacy">Read privacy policy</a></div><div className="reload-art reveal"><PrivacyTab state="edited"/><div className="reload"><RefreshCw/><span>Reload</span></div><PrivacyTab state="original"/><PrivacyFiles/></div></section>; }

function FinalCTA() { return <section className="final section" id="waitlist"><div className="reveal"><h2>Make the correction<br/><em>visible and sendable</em></h2><WaitlistForm source="footer"/><p className="micro">Be first to select, tune, and hand off live UI directly from Chrome.</p></div></section>; }

function Footer() { return <footer><Logo/><p>Live-page design inspection for product teams.</p><div><a href="#how">How it works</a><a href="#features">Features</a><a href="#privacy">Privacy</a><a href="https://github.com/Itamardesign/Ai-Design-Last-Mile"><Github/> GitHub</a></div><span>© 2026 Pixel Poke</span></footer>; }

function App() {
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reveals = [...document.querySelectorAll('.reveal')];
    if (reduced) reveals.forEach(el => el.classList.add('is-visible'));
    else {
      const io = new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting && e.target.classList.add('is-visible')), { threshold: .13 });
      reveals.forEach(el => io.observe(el));
      let raf = 0;
      const update = () => { const max = Math.max(1, document.documentElement.scrollHeight - innerHeight); document.documentElement.style.setProperty('--page-scroll', String(scrollY)); document.documentElement.style.setProperty('--scroll-progress', String(Math.min(1, scrollY / max))); document.querySelectorAll<HTMLElement>('[data-parallax]').forEach(el => { const r = el.getBoundingClientRect(); const rate = Number(el.dataset.parallax || 0); el.style.setProperty('--parallax', `${(r.top - innerHeight/2) * rate}px`); }); raf = 0; };
      const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
      addEventListener('scroll', onScroll, { passive:true }); update();
      return () => { io.disconnect(); removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
    }
  }, []);
  return <><div className="scroll-progress" aria-hidden="true"></div><div className="ambient" aria-hidden="true"><i/><i/><i/><i/></div><Navbar/><main><Hero/><Story/><Steps/><Features/><Privacy/><FinalCTA/></main><Footer/></>;
}

createRoot(document.getElementById('root')!).render(<App/>);
