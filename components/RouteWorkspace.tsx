'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowRight, Bike, CarFront, ChevronDown, Footprints, LocateFixed, MapPin, MousePointer2, Navigation, Route, Search, Volume2, VolumeX, X } from 'lucide-react';
import { MapView } from '@/components/MapView';
import type { Incident } from '@/data';
import { incidentPeriodRange, type IncidentPeriodPreset } from '@/periods';
import { LatestRouteRequestGate, advanceManeuverOneStep, matchRoutePosition, navigationContextIsCurrent, nextVoiceCue, offRouteThreshold, plausibleGpsTransition, pointDistanceMeters, routeCumulativeMeters, updateArrivalConfirmation, updateOffRouteFixCount, validGpsPosition } from '@/navigation-logic.mjs';

type Point={lat:number;lon:number};
type Profile='foot'|'bicycle'|'car'|'motorcycle';
type Maneuver={instruction:string;length_m:number;duration_s:number;begin_index:number;end_index:number;type:number;travel_mode:string};
type Coverage={event_type:string;temporal_coverage_percent:number;statistical_completeness_percent:number|null;coordinate_accuracy_m:number|null;last_event_date:string|null};
type Alternative={id:string;distance_m:number;duration_s:number;duration_source:string;risk_score:number|null;risk_confidence:string;risk_data_status:'available'|'no_nearby_events'|'no_source_data'|'insufficient_statistics'|'source_error'|'stale_snapshot'|'unavailable';risk_data_age_days:number|null;risk_data_max_age_days:number;risk_data_stale_reason:'sync_error'|'age_unknown'|'age_limit'|null;risk_model_version:string;risk_explanation:string;crime_events:number;traffic_accident_events:number;crime_exposure_per_km:number;traffic_accident_exposure_per_km:number;risk_coverage:Coverage[];geometry:{type:'LineString';coordinates:[number,number][]};maneuvers:Maneuver[]};
type Place={id:string;label:string;detail:string;lat:number;lon:number};

const modes:{id:Profile;label:string;short:string;Icon:typeof Footprints}[]=[
  {id:'foot',label:'Пешком',short:'Пешком',Icon:Footprints},
  {id:'bicycle',label:'Велосипед / самокат',short:'Вело / самокат',Icon:Bike},
  {id:'car',label:'Автомобиль',short:'Авто',Icon:CarFront},
  {id:'motorcycle',label:'Мотоцикл',short:'Мото',Icon:Navigation},
];
const places=[{name:'Ботанический сад',lat:51.1095,lon:71.432},{name:'Байтерек',lat:51.1283,lon:71.430},{name:'Набережная Есиля',lat:51.117,lon:71.408},{name:'Астана Арена',lat:51.108,lon:71.403},{name:'Триумфальная арка',lat:51.106,lon:71.45},{name:'Национальный музей',lat:51.123,lon:71.466}];
const profileNames:Record<Profile,string>={foot:'пешком',bicycle:'на велосипеде / самокате',car:'на автомобиле',motorcycle:'на мотоцикле'};
function routeComparisonSummary(item:Alternative,preference:string,rankingApplied:boolean){if(item.risk_data_status==='unavailable'||item.risk_data_status==='source_error')return 'Источник данных временно недоступен. Маршрут построен; оценка риска не рассчитана.';if(item.risk_data_status==='stale_snapshot'){const age=item.risk_data_age_days==null?'давность неизвестна':`${item.risk_data_age_days} дн.`;const reason=item.risk_data_stale_reason==='sync_error'?'Последняя синхронизация Qamqor завершилась ошибкой.':item.risk_data_stale_reason==='age_limit'?'Снимок старше допустимого срока.':'Дата обновления источника неизвестна.';if(preference==='less_events'&&!rankingApplied)return `${reason} Снимок ${age} старше допустимого срока ${item.risk_data_max_age_days} дней; сортировка по экспозиции отключена, порядок вариантов задан Valhalla.`;return `${reason} Используется снимок ${age}; ранжирование по нему допускается не старше ${item.risk_data_max_age_days} дней.`;}if(item.risk_data_status==='no_source_data')return 'В источниках нет загруженных записей. Это не означает низкий риск; маршрут построен.';if(item.risk_data_status==='no_nearby_events')return 'За выбранный период рядом с маршрутом записи не найдены. Это не означает низкий риск.';if(item.risk_data_status==='insufficient_statistics')return 'Данных рядом с маршрутом недостаточно для устойчивого сравнения; маршрут построен.';if(item.risk_score===null)return 'У вариантов совпадает взвешенная историческая экспозиция.';if(item.risk_score<48)return 'По доступным данным экспозиция этого пути ниже, чем у других вариантов.';if(item.risk_score>52)return 'По доступным данным экспозиция этого пути выше, чем у других вариантов.';return 'По доступным данным экспозиция сопоставима с другими вариантами.';}
function formatEta(seconds:number){const minutes=Math.round(seconds/60);if(minutes<1)return 'меньше минуты';if(minutes<60)return `~${minutes} мин`;const hours=Math.floor(minutes/60),rest=minutes%60;return rest?`~${hours} ч ${rest} мин`:`~${hours} ч`;}
function formatDistance(meters:number){return meters<1000?`${Math.max(10,Math.round(meters/10)*10)} м`:`${(meters/1000).toFixed(1)} км`;}
function maxSpeedFor(profile:Profile){return profile==='foot'?10:profile==='bicycle'?30:60;}
function bearingBetween(a:Point,b:Point){const radians=Math.PI/180;const lat1=a.lat*radians,lat2=b.lat*radians,deltaLon=(b.lon-a.lon)*radians;return(Math.atan2(Math.sin(deltaLon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(deltaLon))*180/Math.PI+360)%360;}

export function RouteWorkspace({incidents}:{incidents:Incident[]}) {
  const [origin,setOrigin]=useState<Point|null>(null);const [destination,setDestination]=useState<Point|null>(null);const [originLabel,setOriginLabel]=useState('');const [destinationLabel,setDestinationLabel]=useState('');const [activePick,setActivePick]=useState<'origin'|'destination'>('origin');
  const [profile,setProfile]=useState<Profile>('foot');const [preference,setPreference]=useState('balanced');const [riskPeriod,setRiskPeriod]=useState('all');
  const [alternatives,setAlternatives]=useState<Alternative[]>([]);const [chosen,setChosen]=useState<Alternative|null>(null);const [riskRankingApplied,setRiskRankingApplied]=useState(false);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [panelOpen,setPanelOpen]=useState(true);
  const [search,setSearch]=useState('');const [searchResults,setSearchResults]=useState<Place[]>([]);const [searching,setSearching]=useState(false);const [searchError,setSearchError]=useState('');
  const [currentPosition,setCurrentPosition]=useState<Point|null>(null);const [gpsBusy,setGpsBusy]=useState(false);const [gpsError,setGpsError]=useState('');
  const [navigationActive,setNavigationActive]=useState(false);const [activeManeuver,setActiveManeuver]=useState(0);const [remainingStepMeters,setRemainingStepMeters]=useState(0);const [voiceEnabled,setVoiceEnabled]=useState(false);const [arrived,setArrived]=useState(false);const [rerouting,setRerouting]=useState(false);
  const [navigationHeading,setNavigationHeading]=useState<number|null>(null);const [headingUp,setHeadingUp]=useState(true);
  const [routeRequestGate]=useState(()=>new LatestRouteRequestGate());
  const activeRouteRef=useRef<Alternative|null>(null);activeRouteRef.current=chosen;
  const destinationRef=useRef(destination);destinationRef.current=destination;
  const currentPositionRef=useRef(currentPosition);currentPositionRef.current=currentPosition;
  const activeManeuverRef=useRef(activeManeuver);activeManeuverRef.current=activeManeuver;
  const buildRouteRef=useRef<((start:Point|null,end:Point|null,keepExisting?:boolean)=>Promise<void>)|null>(null);
  const lastFixRef=useRef<{point:Point;timestamp:number;accuracy:number}|null>(null);const routeProgressRef=useRef<{segmentIndex:number;progress_m:number}|null>(null);const offRouteFixesRef=useRef(0);const lastRerouteAtRef=useRef(0);const arrivalFixesRef=useRef(0);const lastManeuverAdvanceProgressRef=useRef(0);
  const activeRouteVersionRef=useRef(0);const navigationSessionRef=useRef(0);const locationRequestRef=useRef(0);
  const announcedVoiceCuesRef=useRef<Set<string>>(new Set());
  const selected=useMemo(()=>[origin,destination].filter((x):x is Point=>!!x),[origin,destination]);
  const routeLines=useMemo(()=>alternatives.map((item)=>({id:item.id,coordinates:item.geometry.coordinates,selected:chosen?.id===item.id})),[alternatives,chosen]);

  function cancelRouteRequest(){routeRequestGate.cancel();locationRequestRef.current++;setLoading(false);setGpsBusy(false);setRerouting(false);}

  async function buildRoute(start=origin,end=destination,keepExisting=false){
    if(!start||!end)return;
    locationRequestRef.current++;
    const request=routeRequestGate.begin({replace:!keepExisting});
    if(!request){if(keepExisting){setRerouting(false);setGpsError('Перестроение ожидает завершения предыдущего запроса.');}return;}
    setError('');setLoading(true);if(!keepExisting){setAlternatives([]);setChosen(null);}setActiveManeuver(0);
    try{
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty'}).format(new Date());const {from,to}=incidentPeriodRange(riskPeriod as IncidentPeriodPreset,today);
      const response=await fetch('/api/v1/routes/alternatives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:start,destination:end,profile,preference,from,to}),signal:request.signal});
      if(!request.isCurrent())return;
      const data=await response.json();if(!request.isCurrent())return;if(!response.ok)throw new Error(data.error?.message??'Не удалось построить маршрут.');
      activeRouteVersionRef.current++;setOrigin(start);setDestination(end);if(start!==origin)setOriginLabel('Моё местоположение');setAlternatives(data.routes);setChosen(data.routes[0]??null);setRiskRankingApplied(data.risk_ranking_applied===true);routeProgressRef.current={segmentIndex:0,progress_m:0};lastManeuverAdvanceProgressRef.current=0;offRouteFixesRef.current=0;arrivalFixesRef.current=0;setArrived(false);setActiveManeuver(0);setRemainingStepMeters(0);
    }catch(err){if(!request.isCurrent()||(err instanceof Error&&err.name==='AbortError'))return;const message=err instanceof Error?err.message:'Не удалось построить маршрут.';setError(message);if(keepExisting)setGpsError(`Не удалось перестроить маршрут: ${message}`);}finally{if(request.finish()){setLoading(false);setRerouting(false);}}
  }
  buildRouteRef.current=buildRoute;
  useEffect(()=>()=>routeRequestGate.cancel(),[routeRequestGate]);
  function setTravelProfile(next:Profile){if(next===profile)return;cancelRouteRequest();navigationSessionRef.current++;locationRequestRef.current++;setRiskRankingApplied(false);setProfile(next);setAlternatives([]);setChosen(null);setNavigationActive(false);setArrived(false);setError('');}
  const onPick=(point:Point)=>{if(navigationActive)return;cancelRouteRequest();if(activePick==='origin'){setOrigin(point);setOriginLabel('');setActivePick('destination');}else{setDestination(point);setDestinationLabel('');setActivePick('origin');}};
  const placePoint=(point:Point,label='')=>{cancelRouteRequest();if(activePick==='origin'){setOrigin(point);setOriginLabel(label);setActivePick('destination');}else{setDestination(point);setDestinationLabel(label);setActivePick('origin');}};
  const clear=()=>{cancelRouteRequest();navigationSessionRef.current++;locationRequestRef.current++;setRiskRankingApplied(false);setOrigin(null);setDestination(null);setOriginLabel('');setDestinationLabel('');setAlternatives([]);setChosen(null);setError('');setGpsError('');setNavigationActive(false);setArrived(false);setRerouting(false);setActivePick('origin');};

  useEffect(()=>{
    const query=search.trim();if(query.length<3){setSearchResults([]);setSearchError('');return;}
    const bias=currentPositionRef.current??origin;const parameters=new URLSearchParams({q:query});if(bias){parameters.set('lat',String(bias.lat));parameters.set('lon',String(bias.lon));}
    const controller=new AbortController();const timer=setTimeout(async()=>{setSearching(true);setSearchError('');try{const response=await fetch(`/api/v1/geocode?${parameters}`,{signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error??'Поиск мест временно недоступен.');setSearchResults(data.results??[]);}catch(err){if(!controller.signal.aborted)setSearchError(err instanceof Error?err.message:'Не удалось выполнить поиск.');}finally{if(!controller.signal.aborted)setSearching(false);}},450);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search,origin]);

  function useCurrentLocation(){
    if(!navigator.geolocation){setGpsError('Браузер не поддерживает определение местоположения.');return;}
    cancelRouteRequest();const requestId=++locationRequestRef.current;setGpsBusy(true);setGpsError('');
    navigator.geolocation.getCurrentPosition(position=>{if(requestId!==locationRequestRef.current)return;if(!validGpsPosition(position)){setGpsError('Точность GPS недостаточна. Переместитесь на открытое место и попробуйте ещё раз.');setGpsBusy(false);return;}const point={lat:position.coords.latitude,lon:position.coords.longitude};setCurrentPosition(point);setOrigin(point);setOriginLabel('Моё местоположение');setActivePick('destination');setGpsBusy(false);},()=>{if(requestId!==locationRequestRef.current)return;setGpsError('Не удалось получить местоположение. Проверьте разрешение браузера.');setGpsBusy(false);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  }

  function startNavigation(){
    if(!chosen)return;
    if(!navigator.geolocation){setGpsError('Для навигации разрешите доступ к местоположению в браузере.');return;}
    locationRequestRef.current++;const session=++navigationSessionRef.current;const routeVersion=activeRouteVersionRef.current;setGpsError('');setArrived(false);setNavigationActive(true);setHeadingUp(true);setNavigationHeading(null);setActiveManeuver(0);setRemainingStepMeters(chosen.maneuvers[0]?.length_m??0);lastFixRef.current=null;routeProgressRef.current={segmentIndex:0,progress_m:0};lastManeuverAdvanceProgressRef.current=0;offRouteFixesRef.current=0;arrivalFixesRef.current=0;announcedVoiceCuesRef.current.clear();
    navigator.geolocation.getCurrentPosition(position=>{if(!navigationContextIsCurrent({session,routeVersion},{session:navigationSessionRef.current,routeVersion:activeRouteVersionRef.current}))return;if(!validGpsPosition(position)){setGpsError('Ожидаю более точное GPS-положение.');return;}setCurrentPosition({lat:position.coords.latitude,lon:position.coords.longitude});},()=>{if(navigationContextIsCurrent({session,routeVersion},{session:navigationSessionRef.current,routeVersion:activeRouteVersionRef.current}))setGpsError('Ожидаю разрешение на местоположение. Включите геолокацию, чтобы видеть позицию на карте.');},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  }

  useEffect(()=>{
    if(!navigationActive||!chosen||!navigator.geolocation)return;
    const watchRouteVersion=activeRouteVersionRef.current;const watchSession=navigationSessionRef.current;
    const watch=navigator.geolocation.watchPosition(position=>{
      if(!navigationContextIsCurrent({routeVersion:watchRouteVersion,session:watchSession},{routeVersion:activeRouteVersionRef.current,session:navigationSessionRef.current}))return;
      if(!validGpsPosition(position)){setGpsError('GPS пока недостаточно точный или устарел; последнее положение сохранено.');return;}
      const point={lat:position.coords.latitude,lon:position.coords.longitude};const accuracy=position.coords.accuracy;const timestamp=position.timestamp;const previousFix=lastFixRef.current;
      if(!plausibleGpsTransition(previousFix,{point,timestamp,accuracy},maxSpeedFor(profile))){setGpsError('GPS сообщил невозможный скачок положения; измерение отброшено.');return;}
      lastFixRef.current={point,timestamp,accuracy};setCurrentPosition(point);setGpsError('');const measuredHeading=previousFix&&pointDistanceMeters(previousFix.point,point)>=5?bearingBetween(previousFix.point,point):position.coords.heading;if(Number.isFinite(measuredHeading))setNavigationHeading(measuredHeading);
      const route=activeRouteRef.current;if(!route)return;const measure=routeCumulativeMeters(route.geometry.coordinates);const previousMatch=routeProgressRef.current;const elapsed=previousFix?Math.max(0.5,(timestamp-previousFix.timestamp)/1000):5;const measuredSpeed=position.coords.speed??(previousFix?pointDistanceMeters(previousFix.point,point)/elapsed:0);const match=matchRoutePosition(point,route.geometry.coordinates,previousMatch,measure,maxSpeedFor(profile)*elapsed+Math.max(accuracy*2,50),{elapsedSeconds:elapsed,speedMps:Math.min(maxSpeedFor(profile),measuredSpeed),heading:position.coords.heading});
      if(!Number.isFinite(match.distance_m))return;
      if(match.matched!==false)routeProgressRef.current={segmentIndex:match.segmentIndex,progress_m:match.progress_m};
      const offRoute=updateOffRouteFixCount(offRouteFixesRef.current,match.distance_m,offRouteThreshold(accuracy));offRouteFixesRef.current=offRoute.count;
      const now=Date.now();if(offRouteFixesRef.current>=3&&now-lastRerouteAtRef.current>20000&&destinationRef.current){lastRerouteAtRef.current=now;offRouteFixesRef.current=0;setRerouting(true);setGpsError('Вы отклонились от пути. Строю новый маршрут…');void buildRouteRef.current?.(point,destinationRef.current,true);}
      const nextManeuver=advanceManeuverOneStep(activeManeuverRef.current,route.maneuvers,previousMatch?.progress_m??0,match.progress_m,measure,lastManeuverAdvanceProgressRef.current);if(nextManeuver!==activeManeuverRef.current){activeManeuverRef.current=nextManeuver;lastManeuverAdvanceProgressRef.current=match.progress_m;setActiveManeuver(nextManeuver);}
      const maneuver=route.maneuvers[nextManeuver];const endIndex=maneuver?Math.max(0,Math.min(route.geometry.coordinates.length-1,maneuver.end_index)):0;setRemainingStepMeters(maneuver?Math.max(0,measure[endIndex]-match.progress_m):0);
      const end=destinationRef.current;const arrival=end?updateArrivalConfirmation(arrivalFixesRef.current,accuracy,position.coords.speed,pointDistanceMeters(point,end),previousFix,{point,timestamp,accuracy}):{count:0,arrived:false};arrivalFixesRef.current=arrival.count;if(arrival.arrived)setArrived(true);
    },()=>setGpsError('Потеряна геолокация. Проверьте разрешение браузера и GPS.'),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    return()=>navigator.geolocation.clearWatch(watch);
  },[navigationActive,chosen,profile]);

  useEffect(()=>{
    if(typeof window==='undefined'||!('speechSynthesis'in window))return;
    if(!navigationActive||!voiceEnabled||!chosen){window.speechSynthesis.cancel();return;}
    const instruction=chosen.maneuvers[activeManeuver]?.instruction;if(!instruction)return;
    const announcement=nextVoiceCue(chosen.id,activeManeuver,instruction,remainingStepMeters,profile,announcedVoiceCuesRef.current);
    if(!announcement)return;
    window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(announcement);utterance.lang='ru-RU';window.speechSynthesis.speak(utterance);
  },[navigationActive,voiceEnabled,chosen,activeManeuver,remainingStepMeters,profile]);

  const navManeuver=chosen?.maneuvers[Math.min(activeManeuver,Math.max(0,(chosen?.maneuvers.length??1)-1))];
  const offRoute=navigationActive&&(rerouting||offRouteFixesRef.current>=3);
  const navRemainingSeconds=navManeuver?Math.round(chosen!.maneuvers.slice(activeManeuver+1).reduce((sum,item)=>sum+item.duration_s,0)+(navManeuver.length_m?navManeuver.duration_s*Math.min(1,remainingStepMeters/navManeuver.length_m):0)):0;
  const mapSelection=navigationActive&&currentPosition?[currentPosition,...(destination?[destination]:[])]:selected;

  return <main className="route-page route-experience">
    <section className="route-map-wrap">
      <MapView incidents={incidents} onPick={onPick} selected={mapSelection} routeAlternatives={routeLines} currentPosition={currentPosition} navigationActive={navigationActive} navigationHeading={navigationHeading} headingUp={headingUp}/>
      <div className="route-map-toolbar"><span><LocateFixed size={15}/>Астана</span><span className="route-map-hint"><MousePointer2 size={14}/>{navigationActive?'Навигация включена':alternatives.length?'Нажмите на маршрут, чтобы сравнить варианты':'Найдите место или выберите точки на карте'}</span>{navigationActive&&<button className="route-camera-toggle" onClick={()=>setHeadingUp(value=>!value)} aria-pressed={headingUp} title={headingUp?'Север сверху':'Курс сверху'}><Navigation size={14}/>{headingUp?'По курсу':'На север'}</button>}</div>
      <div className="route-map-legend"><span><i className="legend-start"/>Начало</span><span><i className="legend-end"/>Конец</span><span><i className="legend-route"/>Выбранный путь</span></div>
      <div className="route-map-footer"><span>Маршруты Valhalla · карта OpenStreetMap</span><span>© OpenStreetMap</span></div>
    </section>
    {panelOpen&&<aside className="route-panel route-floating-panel" aria-label="Навигатор SafeRoute">
      <div className="route-panel-heading"><div><span className="eyebrow">НАВИГАТОР · АСТАНА</span><h1>Куда направимся?</h1></div><button className="floating-close route-panel-close" onClick={()=>setPanelOpen(false)} aria-label="Свернуть панель"><X size={17}/></button></div>

      <div className="transport-mode-picker" role="group" aria-label="Вид транспорта">{modes.map(({id,label:modeLabel,short,Icon})=><button key={id} className={profile===id?'transport-mode active':'transport-mode'} aria-pressed={profile===id} title={modeLabel} onClick={()=>setTravelProfile(id)}><Icon size={16}/><span>{short}</span></button>)}</div>

      {navigationActive&&chosen&&<div className="active-navigation">
        <div className="active-navigation-head"><span>СЛЕДУЮЩИЙ МАНЁВР</span><button onClick={()=>setVoiceEnabled(value=>!value)} aria-label={voiceEnabled?'Выключить голосовые подсказки':'Включить голосовые подсказки'} title={voiceEnabled?'Выключить голосовые подсказки':'Включить голосовые подсказки'}>{voiceEnabled?<Volume2 size={16}/>:<VolumeX size={16}/>}</button></div>
        <strong>{arrived?'Вы прибыли':navManeuver?.instruction??'Продолжайте движение по маршруту'}</strong>
        <small>{arrived?'Пункт назначения рядом':navManeuver?`Осталось по шагу: ${formatDistance(remainingStepMeters)}`:'Следуйте по выделенному маршруту'}</small>
        {offRoute&&<div className="off-route-message"><span>{rerouting?'Подтверждено отклонение. Перестраиваю путь…':'Подтверждено отклонение от маршрута'}</span></div>}
        {gpsError&&<p className="navigation-gps-note">{gpsError}</p>}
        <div className="active-navigation-actions"><span>{arrived?'Пункт назначения':`До конца: ${formatEta(navRemainingSeconds)}`}</span><button onClick={()=>{navigationSessionRef.current++;setNavigationActive(false);setArrived(false);setRerouting(false);setNavigationHeading(null);window.speechSynthesis?.cancel();}}>Завершить</button></div>
      </div>}

      <div className="route-search-box"><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Поиск адреса или места" aria-label="Поиск адреса или места"/><span>{searching?'…':''}</span></div>
      {searchResults.length>0&&<div className="route-search-results" role="listbox" aria-label="Результаты поиска">{searchResults.map(place=><button key={place.id} role="option" aria-selected="false" onClick={()=>{placePoint({lat:place.lat,lon:place.lon},place.label);setSearch('');setSearchResults([]);}}><MapPin size={15}/><span><b>{place.label}</b><small>{place.detail||'Астана'}</small></span></button>)}<small className="geocode-attribution">Поиск мест: OpenStreetMap · Photon</small></div>}
      {searchError&&<div className="route-inline-error">{searchError}</div>}

      <div className="route-endpoints"><div className="endpoint-icon-stack"><span className="endpoint-origin"/><i/><span className="endpoint-destination"/></div><div className="endpoint-fields">
        <button onClick={()=>setActivePick('origin')} className={activePick==='origin'?'route-endpoint selected-endpoint':'route-endpoint'} aria-pressed={activePick==='origin'}><small>НАЧАЛО</small><span>{origin?originLabel||`${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}`:'Выберите на карте или найдите место'}</span></button><div className="endpoint-divider"/>
        <button onClick={()=>setActivePick('destination')} className={activePick==='destination'?'route-endpoint selected-endpoint':'route-endpoint'} aria-pressed={activePick==='destination'}><small>КОНЕЦ</small><span>{destination?destinationLabel||`${destination.lat.toFixed(5)}, ${destination.lon.toFixed(5)}`:'Выберите на карте или найдите место'}</span></button>
      </div><div className="route-point-actions"><button className="swap-button" title="Поменять точки местами" aria-label="Поменять точки местами" onClick={()=>{setOrigin(destination);setDestination(origin);setOriginLabel(destinationLabel);setDestinationLabel(originLabel);}}><ArrowDownUp size={16}/></button><button className="swap-button" title="Очистить точки" aria-label="Очистить точки" onClick={clear}><X size={16}/></button></div></div>
      <div className="route-endpoint-secondary"><button onClick={useCurrentLocation} disabled={gpsBusy}><LocateFixed size={14}/>{gpsBusy?'Определяем…':'Моё местоположение'}</button><span>{activePick==='origin'?'Выберите точку начала':'Выберите точку назначения'}</span></div>
      {gpsError&&!navigationActive&&<div className="route-inline-error">{gpsError}</div>}

      <div className="route-options-row"><label><span>Предпочтение</span><div className="select-wrap"><Route size={15}/><select aria-label="Предпочтение маршрута" value={preference} onChange={event=>{setPreference(event.target.value);setRiskRankingApplied(false);}}><option value="balanced">Сбалансированный</option><option value="shortest">Кратчайший</option><option value="less_events">Меньше событий</option></select><ChevronDown size={14}/></div></label><label><span>Период оценки</span><div className="select-wrap"><select aria-label="Период данных для оценки" value={riskPeriod} onChange={event=>setRiskPeriod(event.target.value)}><option value="7d">7 дней</option><option value="30d">30 дней</option><option value="90d">90 дней</option><option value="all">Весь период</option></select><ChevronDown size={14}/></div></label></div>
      <button className="button button-primary build-route-button" disabled={!origin||!destination||loading} onClick={()=>void buildRoute()}>{loading?'Строим маршрут…':alternatives.length?'Перестроить маршрут':<>Построить маршрут <ArrowRight size={16}/></>}</button>
      <p className="route-time-disclosure">Время рассчитано Valhalla по выбранному транспорту и данным дорог OpenStreetMap. Актуальные пробки не учитываются.</p>
      {error&&<div className="route-error"><MapPin size={16}/><div><b>Не удалось построить маршрут</b><span>{error}</span></div></div>}

      {alternatives.length>0&&<>
        <div className="alternatives-heading"><h2>Варианты</h2><span>{alternatives.length} {alternatives.length===1?'маршрут':'маршрута'}</span></div>
        {!navigationActive&&<div className="alternatives-list">{alternatives.map((item,index)=><button onClick={()=>{activeRouteVersionRef.current++;setChosen(item);setActiveManeuver(0);}} key={item.id} className={chosen?.id===item.id?'alternative-card alternative-selected':'alternative-card'} aria-pressed={chosen?.id===item.id}>
          <span className={`alternative-index index-${index}`}>{chosen?.id===item.id?'✓':index+1}</span><span className="alternative-content"><b>{item.risk_data_status==='stale_snapshot'?(riskRankingApplied&&preference==='less_events'&&index===0?'Меньше событий · снимок устарел':`Снимок устарел · ${item.risk_data_age_days??'?'} дн.`):riskRankingApplied&&index===0?'Меньше событий':index===0?'Рекомендуемый':`Вариант ${index+1}`}</b><small>{(item.distance_m/1000).toFixed(1)} км <i>·</i> {formatEta(item.duration_s)}</small></span>
          <span className="alternative-risk">{item.risk_score==null?<><i className="risk-unknown"/>{item.risk_confidence==='limited'?'Сходная оценка':'Мало данных'}</>:<><i className="risk-medium"/>Отн. {item.risk_score}/100</>}</span>
        </button>)}</div>}
        {chosen&&<div className="route-selected-summary">
          {!navigationActive&&<button className="start-navigation-button" onClick={startNavigation}><Navigation size={16}/>Начать навигацию</button>}
          {chosen.maneuvers.length>0&&<details className="route-steps-details" open={navigationActive}><summary>Пошаговый маршрут <span>{chosen.maneuvers.length} манёвров</span><ChevronDown size={15}/></summary><ol>{chosen.maneuvers.map((maneuver,index)=><li key={`${maneuver.begin_index}-${index}`} className={navigationActive&&index===activeManeuver?'active-step':''}><span className="route-step-index">{index+1}</span><span><b>{maneuver.instruction}</b><small>{formatDistance(maneuver.length_m)} · {formatEta(maneuver.duration_s)}</small></span></li>)}</ol></details>}
          <div className="route-exposure-grid"><div><span>Преступления</span><b>{chosen.crime_events.toLocaleString('ru-RU')}</b><small>записей рядом · вклад {chosen.crime_exposure_per_km.toFixed(2)} / км</small></div><div><span>ДТП</span><b>{chosen.traffic_accident_events.toLocaleString('ru-RU')}</b><small>записей рядом · вклад {chosen.traffic_accident_exposure_per_km.toFixed(2)} / км</small></div></div>
          <p>{routeComparisonSummary(chosen,preference,riskRankingApplied)}</p>
          <details className="route-method-details"><summary>Как рассчитывается оценка <ChevronDown size={15}/></summary><div><p>Индекс сравнивает только варианты этой поездки. Он не показывает абсолютную безопасность и не является вероятностью происшествия. Меньшее значение означает меньшую взвешенную экспозицию относительно остальных построенных вариантов.</p><p>Для преступлений и ДТП учитываются расстояние до пути (до 150 м), давность, точность координат и временной диапазон источника. Все категории имеют одинаковый вес; неизвестным кодам тяжесть не назначается.</p><p>Время маршрута — оценка Valhalla по атрибутам дорожного графа для профиля «{profileNames[profile]}». Оно не учитывает актуальные заторы, дорожные работы и задержки на пути.</p><div className="route-source-dates">{chosen.risk_coverage.map(source=><span key={source.event_type}>{source.event_type==='crime'?'Преступления':'ДТП'}: последнее событие {source.last_event_date??'нет записей'} · временной охват по диапазону дат {source.temporal_coverage_percent}% · полнота {source.statistical_completeness_percent===null?'не опубликована':`${source.statistical_completeness_percent}%`}</span>)}</div><small>Период: {riskPeriod==='all'?'весь доступный':'последние '+(riskPeriod==='7d'?'7':riskPeriod==='30d'?'30':'90')+' дней'} · все категории. Неполнота выгрузки неизвестна. Без стабильного ID совпадения источника могут быть повтором или разными событиями. Модель {chosen.risk_model_version}.</small></div></details>
        </div>}
      </>}
      {!alternatives.length&&!error&&<div className="route-empty"><div className="route-empty-icon"><Footprints size={19}/></div><b>Выберите транспорт и точки</b><p>Найдите адрес или выберите начало и конец на карте. SafeRoute покажет время по выбранному профилю и пошаговый маршрут.</p><div className="suggested-places"><span>Популярные места</span>{places.map((place,index)=><button key={place.name} onClick={()=>placePoint({lat:place.lat,lon:place.lon},place.name)}><i className={index%2?'suggestion-square':''}/>{place.name}</button>)}</div></div>}
      <button className="route-sheet-handle" aria-label="Свернуть панель" onClick={()=>setPanelOpen(false)}/>
    </aside>}
    {!panelOpen&&<button className="route-panel-reopen" onClick={()=>setPanelOpen(true)}><Route size={16}/>Навигатор</button>}
  </main>;
}
