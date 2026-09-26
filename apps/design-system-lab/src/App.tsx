import { useMemo, useState } from 'react';
import { BentoComposer, ShapeLegend, TopBar, cssVariables, getKit, pageKits, type PageId } from '@signal-arena/ui-game';
import { PlaySlice } from './play/PlaySlice';
import { AcademySlice } from './academy/AcademySlice';
import { HubNextBestAction } from './academy/HubNextBestAction';

type ViewMode = 'preview' | 'runtime' | 'play' | 'academy';
const ACADEMY_MODULE_ID = 'invalidation_before_direction';
const STORAGE_KEY = 'sa-lab-viewmode';
const readMode = (): ViewMode => {
  if (typeof window === 'undefined') return 'preview';
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === 'runtime' || raw === 'preview' || raw === 'play' || raw === 'academy') return raw;
  } catch { /* sessionStorage may be unavailable (private mode); fall through */ }
  return 'preview';
};
const writeMode = (mode: ViewMode) => {
  try { window.sessionStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
};

export function App() {
  const initialPage = ((window as unknown as { __INITIAL_PAGE__?: PageId }).__INITIAL_PAGE__ ?? 'hub');
  const initialDevice = ((window as unknown as { __INITIAL_DEVICE__?: 'desktop' | 'mobile' }).__INITIAL_DEVICE__ ?? 'desktop');
  const [mode, setMode] = useState<ViewMode>(readMode);
  const [page, setPage] = useState<PageId>(initialPage);
  const kit = getKit(page);
  const [presetIndex, setPresetIndex] = useState(0);
  const preset = kit.presets[presetIndex % kit.presets.length];
  const [device, setDevice] = useState<'desktop' | 'mobile'>(initialDevice);
  const key = `${page}-${preset.id}`;
  const shuffle = () => setPresetIndex((i) => (i + 1) % kit.presets.length);
  const toggleMode = () => setMode((m) => { const next: ViewMode = m === 'preview' ? 'runtime' : 'preview'; writeMode(next); return next; });
  const enterPlay = () => { writeMode('play'); setMode('play'); };
  const enterAcademy = () => { writeMode('academy'); setMode('academy'); };
  const stats = useMemo(() => ({
    widgets: preset.widgets.length,
    shapes: new Set(preset.widgets.map((w) => w.footprint)).size
  }), [key]);

  if (mode === 'play') {
    return (
      <div className={`app runtime ${device}`} data-token-snapshot={cssVariables()}>
        <TopBar />
        <main>
          <section className="runtime-head">
            <div>
              <span className="kicker">ТРЕНИРОВКА РЕШЕНИЙ</span>
              <h2>Сценарий → решение → фиксация → результат</h2>
            </div>
            <div className="runtime-actions">
              <button className="secondary" onClick={() => setDevice((d) => (d === 'desktop' ? 'mobile' : 'desktop'))}>{device === 'desktop' ? 'Mobile' : 'Desktop'}</button>
              <button className="primary" onClick={() => { writeMode('preview'); setMode('preview'); }}>Back to Preview</button>
            </div>
          </section>
          <PlaySlice />
        </main>
      </div>
    );
  }

  if (mode === 'academy') {
    return (
      <div className={`app runtime ${device}`} data-token-snapshot={cssVariables()}>
        <TopBar />
        <main>
          <section className="runtime-head">
            <div>
              <span className="kicker">ACADEMY · LEVEL 0</span>
              <h2>Инвалидация до направления</h2>
            </div>
            <div className="runtime-actions">
              <button className="secondary" onClick={() => setDevice((d) => (d === 'desktop' ? 'mobile' : 'desktop'))}>{device === 'desktop' ? 'Mobile' : 'Desktop'}</button>
              <button className="primary" onClick={() => { writeMode('preview'); setMode('preview'); }}>Back to Preview</button>
            </div>
          </section>
          <div className="academy-hub-strip">
            <HubNextBestAction moduleId={ACADEMY_MODULE_ID} onOpen={enterAcademy} />
          </div>
          <AcademySlice />
        </main>
      </div>
    );
  }

  if (mode === 'runtime') {
    return (
      <div className={`app runtime ${device}`} data-token-snapshot={cssVariables()}>
        <TopBar />
        <main>
          <section className="runtime-head">
            <div>
              <span className="kicker">{kit.id.toUpperCase()} · RUNTIME</span>
              <h2>{preset.label}</h2>
            </div>
            <div className="runtime-actions">
              <button className="secondary" onClick={() => setDevice((d) => (d === 'desktop' ? 'mobile' : 'desktop'))}>{device === 'desktop' ? 'Mobile' : 'Desktop'}</button>
              <button className="secondary" onClick={shuffle}>Variant ↻</button>
              <button className="primary" onClick={toggleMode}>Back to Preview</button>
            </div>
          </section>
          <nav className="page-tabs" aria-label="Page kits">
            {pageKits.map((k) => (
              <button key={k.id} className={page === k.id ? 'active' : ''} onClick={() => { setPage(k.id); setPresetIndex(0); }}>
                <span>{k.label}</span><small>{k.presets.length} presets</small>
              </button>
            ))}
          </nav>
          <div className="runtime-surface">
            <BentoComposer key={key} kit={kit} preset={preset} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app preview ${device}`} data-token-snapshot={cssVariables()}>
      <TopBar />
      <main>
        <section className="lab-head">
          <div>
            <span className="kicker">PAGE KIT GENERATOR · FOUNDATION V1</span>
            <h1>Пять страниц. Одна система.</h1>
            <p>Валидируемые page kits, Bento footprints и общие semantic tokens. Каждый preview собран из зарегистрированных групп, а не из произвольного JSX.</p>
          </div>
          <div className="lab-actions">
            <button className="secondary" onClick={() => setDevice((d) => (d === 'desktop' ? 'mobile' : 'desktop'))}>{device === 'desktop' ? 'Mobile preview' : 'Desktop preview'}</button>
            <button className="primary" onClick={shuffle}>Сгенерировать вариант ↻</button>
            <button className="secondary" onClick={toggleMode}>Runtime mode →</button>
            <button className="secondary" data-testid="enter-play" onClick={enterPlay}>Play vertical slice →</button>
            <button className="secondary" data-testid="enter-academy" onClick={enterAcademy}>Academy Level 0 →</button>
          </div>
        </section>
        <nav className="page-tabs" aria-label="Page kits">
          {pageKits.map((k) => (
            <button key={k.id} className={page === k.id ? 'active' : ''} onClick={() => { setPage(k.id); setPresetIndex(0); }}>
              <span>{k.label}</span><small>{k.presets.length} presets</small>
            </button>
          ))}
        </nav>
        <section className="workspace">
          <aside>
            <div className="aside-block">
              <span className="kicker">ACTIVE PAGE KIT</span>
              <h2>{kit.label}</h2>
              <p>{kit.description}</p>
            </div>
            <div className="aside-block">
              <span className="kicker">LAYOUT PRESETS</span>
              {kit.presets.map((p, i) => (
                <button key={p.id} className={`preset ${i === presetIndex ? 'active' : ''}`} onClick={() => setPresetIndex(i)}>
                  <b>{p.label}</b><small>{p.description}</small>
                </button>
              ))}
            </div>
            <div className="aside-block meta">
              <span><b>{stats.widgets}</b> widgets</span>
              <span><b>{stats.shapes}</b> shapes</span>
              <span><b>0</b> raw CSS values</span>
            </div>
            <ShapeLegend />
            <div className="aside-note">
              <b>Production guardrail</b>
              <p>Генератор меняет только разрешённые presets, footprints и variants. Новая композиция сначала проходит preview и QA.</p>
            </div>
          </aside>
          <div className="preview-shell">
            <div className="preview-title">
              <div>
                <span className="kicker">{kit.id.toUpperCase()} · {preset.id.toUpperCase()}</span>
                <h2>{preset.label}</h2>
              </div>
              <span className="valid">✓ VALID RECIPE</span>
            </div>
            <div className="preview" style={{ '--accent': kit.accent } as React.CSSProperties}>
              <div className="preview-appbar">
                <b>{kit.label}</b>
                <div><span>Search</span><span>Profile</span></div>
              </div>
              <BentoComposer key={key} kit={kit} preset={preset} />
            </div>
          </div>
        </section>
        <section className="completion">
          <div>
            <span className="kicker">CLOSED SCOPE</span>
            <h2>Design System Integration Foundation v1</h2>
            <p>Этот пакет закрывает конфиг, registries, пять page kits, два валидных preset на страницу, Bento Composer и responsive preview. Product backend и server Seal в этот этап не входят.</p>
          </div>
          <ul>
            <li>5 root pages</li>
            <li>10 page presets</li>
            <li>Typed config</li>
            <li>Responsive composer</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
