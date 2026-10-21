'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Layers2, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { MapView } from '@/components/MapView';
import type { MapAggregate } from '@/data';

type SourceCoverage={source_id:string;name:string;event_type:'crime'|'traffic_accident';last_event_date:string|null;coverage_start:string|null;coverage_end:string|null;record_count:number;attribution:string|null};
type CategoryCount={event_type:'crime'|'traffic_accident';category_code:string;count:number};
type MapResponse={items:MapAggregate[];total:number;aggregate_count:number;categories:CategoryCount[];sources:SourceCoverage[];period:{from:string;to:string;available_from:string|null;available_to:string|null};aggregation:{disclosure:string}};
type Period='7d'|'30d'|'90d'|'all'|'custom';
const periodNames:Record<Period,string>={'7d':'7 дней','30d':'30 дней','90d':'90 дней',all:'Весь период',custom:'выбранный интервал'};

export function MapWorkspace() {
  const [items,setItems]=useState<MapAggregate[]>([]); const [categories,setCategories]=useState<CategoryCount[]>([]); const [sources,setSources]=useState<SourceCoverage[]>([]); const [total,setTotal]=useState(0);
  const [period,setPeriod]=useState<Period>('all'); const [visibleTypes,setVisibleTypes]=useState({crime:true,traffic_accident:true}); const [category,setCategory]=useState(''); const [mode,setMode]=useState<'clusters'|'heat'>('clusters');
  const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [refresh,setRefresh]=useState(0); const [selected,setSelected]=useState<MapAggregate|null>(null); const [panelOpen,setPanelOpen]=useState(true);
  const [dateFilter,setDateFilter]=useState<{from:string;to:string}|null>(null); const [bbox,setBbox]=useState<string|null>(null); const [urlReady,setUrlReady]=useState(false);
  const eventTypes=useMemo(()=>Object.entries(visibleTypes).filter(([,visible])=>visible).map(([type])=>type),[visibleTypes]);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const from=params.get('from'),to=params.get('to'),bounds=params.get('bbox'),requestedTypes=params.get('event_type'),initialCategory=params.get('category');if(from&&to&&/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)){setDateFilter({from,to});setPeriod('custom');}if(bounds)setBbox(bounds);if(requestedTypes){const values=requestedTypes.split(',');setVisibleTypes({crime:values.includes('crime'),traffic_accident:values.includes('traffic_accident')});}if(initialCategory)setCategory(initialCategory);setUrlReady(true);},[]);
  useEffect(()=>{if(!urlReady)return;let active=true;setLoading(true);setError('');const params=new URLSearchParams({period:period==='custom'?'all':period,event_type:eventTypes.join(',')});if(category)params.set('category',category);if(dateFilter){params.set('from',dateFilter.from);params.set('to',dateFilter.to);}if(bbox)params.set('bbox',bbox);
    fetch(`/api/v1/map/aggregates?${params}`).then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Не удалось загрузить карту.');return result as MapResponse;}).then(data=>{if(!active)return;setItems(data.items);setCategories(data.categories);setSources(data.sources);setTotal(data.total);}).catch(err=>{if(active){setItems([]);setCategories([]);setSources([]);setTotal(0);setError(err instanceof Error?err.message:'Не удалось загрузить карту.');}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[period,category,eventTypes,refresh,dateFilter,bbox,urlReady]);
  const categoryOptions=categories.filter(item=>visibleTypes[item.event_type]);
  const totalsByType=categories.reduce((result,item)=>{result[item.event_type]=(result[item.event_type]??0)+item.count;return result;},{crime:0,traffic_accident:0} as Record<'crime'|'traffic_accident',number>);
  const source=(type:'crime'|'traffic_accident')=>sources.find(item=>item.event_type===type);
  const reset=()=>{setCategory('');setPeriod('all');setDateFilter(null);setBbox(null);setVisibleTypes({crime:true,traffic_accident:true});};
  return <main className="map-page map-experience">
    <section className="map-stage"><MapView incidents={items} mode={mode} visibleTypes={visibleTypes} onAggregateSelect={setSelected}/>
      <div className="map-top-pill"><span className="status-dot"/>Астана, Казахстан <i/> <span>Данные Qamqor</span></div>
      <div className="map-mode-control" role="group" aria-label="Режим карты"><button className={mode==='clusters'?'selected':''} onClick={()=>setMode('clusters')}><Layers2 size={15}/>Кластеры</button><button className={mode==='heat'?'selected':''} onClick={()=>setMode('heat')}>Тепловая карта</button></div>
      {!panelOpen&&<button className="map-panel-reopen" onClick={()=>setPanelOpen(true)}><SlidersHorizontal size={16}/> Фильтры карты</button>}
      {selected&&<section className="map-selection-card" aria-live="polite"><button className="floating-close" onClick={()=>setSelected(null)} aria-label="Закрыть"><X size={16}/></button><span className="eyebrow">ВЫБРАННАЯ ОБЛАСТЬ</span><h2>{selected.event_type==='crime'?'Преступления':'ДТП'} · {selected.category_code}</h2><strong>{selected.count.toLocaleString('ru-RU')} <small>записей в ячейке</small></strong><p>{selected.first_date} — {selected.last_date}</p><small>Агрегированная область около 350–550 м · источник Qamqor</small></section>}
      {error&&<div className="map-empty"><MapPin size={20}/><b>Не удалось загрузить события</b><span>{error}</span><button onClick={()=>setRefresh(value=>value+1)}>Повторить</button></div>}
      {!items.length&&!loading&&!error&&<div className="map-empty"><MapPin size={20}/><b>Нет записей в выборке</b><span>Измените период или включите источник. Пустые данные не означают низкий риск.</span></div>}
      <div className="map-legend map-legend-floating"><strong>НА КАРТЕ</strong><span><i className="legend-dot dot-crime"/>Преступления</span><span><i className="legend-dot dot-accident"/>ДТП</span><small>Размер отражает число записей, не тяжесть события.</small></div>
      <div className="map-attribution">© OpenStreetMap · данные событий: Qamqor</div>
    </section>
    {panelOpen&&<aside className="map-floating-panel" aria-label="Фильтры карты">
      <div className="floating-panel-head"><div><span className="eyebrow">ГОРОДСКИЕ СОБЫТИЯ</span><h1>Исследуйте карту</h1></div><button className="floating-close panel-desktop-close" onClick={()=>setPanelOpen(false)} aria-label="Свернуть фильтры"><X size={17}/></button></div>
      <label className="field-label" htmlFor="map-period">Период</label><div className="select-wrap"><CalendarDays size={15}/><select id="map-period" aria-label="Период данных" value={period} onChange={event=>{setPeriod(event.target.value as Period);setDateFilter(null);setBbox(null);}}>{period==='custom'&&<option value="custom">Интервал аналитики</option>}<option value="7d">Последние 7 дней</option><option value="30d">Последние 30 дней</option><option value="90d">Последние 90 дней</option><option value="all">Весь доступный период</option></select><ChevronDown size={14}/></div>
      <label className="field-label" htmlFor="map-category">Категория</label><div className="select-wrap"><Layers2 size={15}/><select id="map-category" value={category} onChange={event=>setCategory(event.target.value)}><option value="">Все категории</option>{categoryOptions.map(item=><option key={`${item.event_type}:${item.category_code}`} value={`${item.event_type}:${item.category_code}`}>{item.event_type==='crime'?'Преступление':'ДТП'} · {item.category_code} ({item.count})</option>)}</select><ChevronDown size={14}/></div>
      <div className="map-source-heading">Источники <button className="text-button" onClick={reset}>Сбросить</button></div>
      <label className="event-layer-toggle crime-layer"><input type="checkbox" checked={visibleTypes.crime} onChange={event=>{setVisibleTypes(value=>({...value,crime:event.target.checked}));setCategory('');}}/><span><i/>Преступления</span><b>{(totalsByType.crime??0).toLocaleString('ru-RU')}</b></label>
      <label className="event-layer-toggle dtp-layer"><input type="checkbox" checked={visibleTypes.traffic_accident} onChange={event=>{setVisibleTypes(value=>({...value,traffic_accident:event.target.checked}));setCategory('');}}/><span><i/>ДТП</span><b>{(totalsByType.traffic_accident??0).toLocaleString('ru-RU')}</b></label>
      <div className="map-result-count"><div><strong>{loading?'…':total.toLocaleString('ru-RU')}</strong><span>записей за {period==='custom'&&dateFilter?`${dateFilter.from} — ${dateFilter.to}`:periodNames[period].toLowerCase()}</span></div><span className="map-result-mark">{items.length.toLocaleString('ru-RU')} областей</span></div>
      <div className="map-source-dates"><div><span>Последнее преступление</span><b>{source('crime')?.last_event_date??'нет записей'}</b></div><div><span>Последнее ДТП</span><b>{source('traffic_accident')?.last_event_date??'нет записей'}</b></div></div>
      <p className="map-panel-note">Карта показывает агрегированные записи за выбранный период. Неполнота источника неизвестна.</p>
      <div className="map-panel-attribution">Информация получена с официального интернет-портала qamqor.gov.kz</div>
      <button className="map-sheet-handle" aria-label="Свернуть фильтры" onClick={()=>setPanelOpen(false)}/>
    </aside>}
    <button className="map-mobile-filters" onClick={()=>setPanelOpen(true)}><SlidersHorizontal size={16}/>Фильтры <span>{loading?'…':total.toLocaleString('ru-RU')}</span></button>
  </main>;
}
