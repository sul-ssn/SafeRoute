import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ChartNoAxesCombined, Navigation, Map, ShieldCheck } from 'lucide-react';
import { MapView } from '@/components/MapView';

export default function HomePage() {
  return <main className="home-page">
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="status-dot"/> Открытые данные · Астана</div>
        <h1>Планируйте путь<br/><span>с ясной картиной города.</span></h1>
        <p className="hero-lead">Планируйте поездки по городу: выбирайте транспорт, находите адреса и следуйте пошаговым подсказкам. Изучайте доступные события рядом с маршрутом.</p>
        <div className="hero-actions"><Link className="button button-primary" href="/route">Открыть навигатор <ArrowRight size={17}/></Link><Link className="button button-quiet" href="/map">Изучить карту <ArrowUpRight size={16}/></Link></div>
        <div className="hero-footnote"><ShieldCheck size={16}/> Индекс показывает различия в доступных данных, а не вероятность происшествия</div>
      </div>
      <div className="hero-visual real-map-preview">
        <MapView incidents={[]}/>
        <div className="preview-label"><span className="status-dot"/>Астана, Казахстан</div>
        <Link href="/map" className="preview-open">Открыть карту <ArrowUpRight size={14}/></Link>
        <div className="preview-attribution">© OpenStreetMap</div>
      </div>
    </section>
    <section className="feature-section"><div className="section-heading"><div><div className="eyebrow">Три инструмента</div><h2>От обзора — к решению</h2></div></div>
      <div className="feature-grid">
        <Link className="feature-card" href="/route"><div className="feature-card-top"><div className="feature-icon green"><Navigation size={20}/></div><ArrowUpRight size={18}/></div><h3>Навигация по городу</h3><p>Выбирайте транспорт, сравнивайте варианты и следуйте пошаговому маршруту.</p><div className="feature-meta"><span className="small-dot green-dot"/>Пешком · велосипед · авто · мото</div></Link>
        <Link className="feature-card" href="/map"><div className="feature-card-top"><div className="feature-icon blue"><Map size={20}/></div><ArrowUpRight size={18}/></div><h3>Карта событий</h3><p>Изучайте агрегированные данные Qamqor по периоду, источнику и категории.</p><div className="feature-meta"><span className="small-dot blue-dot"/>Преступления и ДТП</div></Link>
        <Link className="feature-card" href="/analytics"><div className="feature-card-top"><div className="feature-icon orange"><ChartNoAxesCombined size={20}/></div><ArrowUpRight size={18}/></div><h3>Городская аналитика</h3><p>Смотрите временной охват, категории и концентрацию событий на карте.</p><div className="feature-meta"><span className="small-dot orange-dot"/>Только доступные записи</div></Link>
      </div>
    </section>
    <footer className="home-footer"><span>SAFEROUTE</span><span>Данные помогают понять контекст, но не гарантируют безопасность</span><Link href="/map">Перейти к карте <ArrowUpRight size={13}/></Link></footer>
  </main>;
}
