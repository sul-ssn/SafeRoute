'use client';

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import type {} from '@tomickigrzegorz/leaflet-rotate';
import type { Incident, MapAggregate } from '@/data';

type MapMode = 'clusters' | 'heat';
type Props = {
  incidents: Array<Incident | MapAggregate>;
  onPick?: (point: {lat:number;lon:number}) => void;
  selected?: {lat:number;lon:number}[];
  routeLine?: [number,number][];
  routeAlternatives?: Array<{id:string;coordinates:[number,number][];selected:boolean}>;
  currentPosition?: {lat:number;lon:number}|null;
  navigationActive?: boolean;
  navigationHeading?: number|null;
  headingUp?: boolean;
  mode?: MapMode;
  visibleTypes?: {crime:boolean;traffic_accident:boolean};
  onAggregateSelect?: (item: MapAggregate) => void;
};

function isAggregate(value: Incident | MapAggregate): value is MapAggregate {
  return 'event_type' in value && 'count' in value;
}

const colors = { crime: '#c94358', traffic_accident: '#e78a33', other: '#1f8a70' } as const;

export function MapView({ incidents, onPick, selected, routeLine, routeAlternatives, currentPosition, navigationActive = false, navigationHeading = null, headingUp = true, mode = 'clusters', visibleTypes = {crime:true,traffic_accident:true}, onAggregateSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const leaflet = useRef<typeof import('leaflet') | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const onPickRef = useRef(onPick);
  const onAggregateSelectRef = useRef(onAggregateSelect);
  const mapLayers = useRef<Leaflet.LayerGroup | null>(null);
  const route = useRef<Leaflet.LayerGroup | null>(null);
  const positionMarker = useRef<Leaflet.CircleMarker | null>(null);
  const [ready,setReady] = useState(false);
  const [zoomLevel,setZoomLevel] = useState(12);
  useEffect(() => { onPickRef.current = onPick; onAggregateSelectRef.current = onAggregateSelect; }, [onPick,onAggregateSelect]);

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;
    void Promise.all([import('leaflet'),import('@tomickigrzegorz/leaflet-rotate')]).then(([{default:L}]) => {
      if (cancelled || !container.current) return;
      leaflet.current = L;
      const instance = L.map(container.current,{center:[51.108,71.43],zoom:12,zoomControl:false,preferCanvas:true,rotate:true,touchRotate:false,dragRotate:false});
      L.control.zoom({position:'bottomright'}).addTo(instance);
      L.tileLayer(process.env.NEXT_PUBLIC_OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
        maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
      }).addTo(instance);
      L.control.scale({metric:true,imperial:false,maxWidth:100}).addTo(instance);
      instance.on('click',(event)=>onPickRef.current?.({lat:Number(event.latlng.lat.toFixed(5)),lon:Number(event.latlng.lng.toFixed(5))}));
      map.current = instance;
      setReady(true);
      requestAnimationFrame(() => instance.invalidateSize());
    });
    return () => { cancelled=true; mapLayers.current?.remove();route.current?.remove();positionMarker.current?.remove();map.current?.remove();map.current=null;mapLayers.current=null;route.current=null;positionMarker.current=null;leaflet.current=null; };
  },[]);

  useEffect(() => {
    const instance=map.current,L=leaflet.current;
    if (!instance || !L || !ready) return;
    mapLayers.current?.remove();
    const layer = L.layerGroup();
    const allowed = incidents.filter((item) => {
      if (isAggregate(item)) return visibleTypes[item.event_type];
      return true;
    });

    if (mode === 'heat') {
      for (const item of allowed) {
        if (isAggregate(item)) {
          const radius=Math.min(88,36+Math.sqrt(item.count)*8),opacity=Math.min(.72,.2+Math.sqrt(item.count)/14);
          const icon=L.divIcon({className:'heat-point-icon',html:`<span class="heat-point" style="--heat-color:${colors[item.event_type]};--heat-size:${radius}px;--heat-opacity:${opacity}"></span>`,iconSize:[radius,radius],iconAnchor:[radius/2,radius/2]});
          L.marker([item.lat,item.lon],{icon,keyboard:false,interactive:false}).bindTooltip(`${item.event_type==='crime'?'Преступления':'ДТП'} · ${item.count} событий · ${item.category_code}`).addTo(layer);
        } else {
          const type=item.eventType==='crime'?'crime':item.eventType==='traffic_accident'?'traffic_accident':'other';
          L.circleMarker([item.lat,item.lon],{radius:14,color:colors[type],weight:0,fillColor:colors[type],fillOpacity:.35}).addTo(layer);
        }
      }
    } else {
      const zoom=zoomLevel;
      const gridMeters=zoom<11?12000:zoom<12?6000:zoom<13?3000:zoom<14?1200:450;
      const bins=new Map<string,{lat:number;lon:number;count:number;type:'crime'|'traffic_accident'|'other';items:MapAggregate[]}>();
      for (const item of allowed) {
        const type=isAggregate(item)?item.event_type:item.eventType==='crime'?'crime':item.eventType==='traffic_accident'?'traffic_accident':'other';
        const lat=item.lat,lon=item.lon;
        const latStep=gridMeters/111320,lonStep=gridMeters/(111320*Math.max(.25,Math.cos(lat*Math.PI/180)));
        const gy=Math.floor(lat/latStep),gx=Math.floor(lon/lonStep),key=`${type}:${gx}:${gy}`;
        const bin=bins.get(key)??{lat:0,lon:0,count:0,type,items:[]};
        const count=isAggregate(item)?item.count:1;
        bin.lat+=lat*count;bin.lon+=lon*count;bin.count+=count;
        if(isAggregate(item))bin.items.push(item);
        bins.set(key,bin);
      }
      for (const bin of bins.values()) {
        const lat=bin.lat/bin.count,lon=bin.lon/bin.count;
        if (bin.count===1 && bin.items.length===0) {
          const icon=L.divIcon({className:'event-marker-icon',html:`<span class="event-marker event-marker-${bin.type}"><span></span></span>`,iconSize:[16,16],iconAnchor:[8,8]});
          L.marker([lat,lon],{icon,keyboard:false,interactive:false}).addTo(layer);
          continue;
        }
        const color=colors[bin.type];
        const icon=L.divIcon({className:'incident-cluster-icon',html:`<span class="incident-cluster incident-cluster-${bin.type}" style="--cluster-color:${color}">${bin.count}</span>`,iconSize:[38,38],iconAnchor:[19,19]});
        const marker=L.marker([lat,lon],{icon,keyboard:true,title:`${bin.count} ${bin.type==='crime'?'преступлений':'ДТП'}`}).addTo(layer);
        marker.bindTooltip(`${bin.type==='crime'?'Преступления':'ДТП'} · ${bin.count} событий`);
        if(bin.items.length) marker.on('click',()=>onAggregateSelectRef.current?.(bin.items[0]));
      }
    }
    layer.addTo(instance);mapLayers.current=layer;

    selected?.forEach((point,index)=>{
      const icon=L.divIcon({className:'route-marker-icon',html:`<span class="route-marker route-marker-${index}">${index===0?'А':'Б'}</span>`,iconSize:[25,25],iconAnchor:[12,22]});
      L.marker([point.lat,point.lon],{icon,keyboard:true,title:index===0?'Начало маршрута':'Назначение'}).addTo(layer);
    });
    route.current?.remove();route.current=null;
    if(routeAlternatives?.length){
      const lines:Leaflet.Layer[]=[];
      const orderedAlternatives=[...routeAlternatives.filter(item=>!item.selected),...routeAlternatives.filter(item=>item.selected)];
      for(const alternative of orderedAlternatives){
        if(!alternative.coordinates.length)continue;
        const latLngs=alternative.coordinates.map(([lon,lat])=>[lat,lon] as [number,number]);
        if(alternative.selected){
          lines.push(L.polyline(latLngs,{color:'#fff',weight:11,opacity:.98,lineCap:'round',lineJoin:'round'}),L.polyline(latLngs,{color:'#166b53',weight:7,opacity:1,lineCap:'round',lineJoin:'round'}));
        }else{
          lines.push(L.polyline(latLngs,{color:'#fff',weight:7,opacity:.68,lineCap:'round',lineJoin:'round'}),L.polyline(latLngs,{color:'#78978a',weight:3,opacity:.62,dashArray:'7 7',lineCap:'round',lineJoin:'round'}));
        }
      }
      route.current=L.layerGroup(lines).addTo(instance);
    }else if(routeLine?.length){
      const latLngs=routeLine.map(([lon,lat])=>[lat,lon] as [number,number]);
      route.current=L.layerGroup([L.polyline(latLngs,{color:'#fff',weight:9,opacity:.78}),L.polyline(latLngs,{color:'#1f8a70',weight:5,opacity:.95})]).addTo(instance);
    }
    const redraw=()=>setZoomLevel(instance.getZoom());
    instance.on('zoomend',redraw);
    return()=>{instance.off('zoomend',redraw);layer.remove();route.current?.remove();route.current=null;};
  },[incidents,selected,routeLine,routeAlternatives,ready,mode,visibleTypes,zoomLevel]);

  useEffect(() => {
    const instance=map.current,L=leaflet.current;
    if(navigationActive&&currentPosition)return;
    if (!instance || !L || !ready || (!routeAlternatives?.length && !routeLine?.length && !selected?.length)) return;
    const chosen=routeAlternatives?.find(item=>item.selected)?.coordinates??routeLine??[];
    const coordinates=chosen.length?chosen:selected?.map(point=>[point.lon,point.lat] as [number,number])??[];
    if(coordinates.length<1)return;
    const bounds=L.latLngBounds(coordinates.map(([lon,lat])=>[lat,lon] as [number,number]));
    if(coordinates.length===1)instance.setView(bounds.getCenter(),15);
    else {
      const mobile=window.matchMedia('(max-width: 760px)').matches;
      instance.fitBounds(bounds,{paddingTopLeft:mobile?[24,76]:[420,44],paddingBottomRight:mobile?[24,270]:[54,54],maxZoom:16});
    }
  },[ready,selected,routeLine,routeAlternatives,navigationActive,currentPosition]);

  useEffect(() => {
    const instance=map.current;
    if(!instance||!ready)return;
    if(!navigationActive||!headingUp){instance.stopHeadingUp();instance.setBearing(0);return;}
    if(navigationHeading!==null)instance.setHeading(navigationHeading,{ease:0.18,deadzone:1});
  },[navigationActive,headingUp,navigationHeading,ready]);

  useEffect(() => {
    const instance=map.current,L=leaflet.current;
    if(!instance||!L||!ready)return;
    if(!currentPosition){positionMarker.current?.remove();positionMarker.current=null;return;}
    const latlng:Leaflet.LatLngExpression=[currentPosition.lat,currentPosition.lon];
    if(positionMarker.current)positionMarker.current.setLatLng(latlng);
    else positionMarker.current=L.circleMarker(latlng,{radius:8,color:'#fff',weight:3,fillColor:'#2478e5',fillOpacity:1}).addTo(instance).bringToFront();
    if(navigationActive)instance.panTo(latlng,{animate:true,duration:0.65});
  },[currentPosition,navigationActive,ready]);

  return <div className="map-canvas" ref={container} aria-label="Интерактивная карта маршрута"/>;
}
