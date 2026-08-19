"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Prefs={sound:boolean;desktop:boolean;volume:number}; const KEY="bakers-whisper:notif-prefs"; const defaults:Prefs={sound:true,desktop:false,volume:.5};
export function useNotifications(){
 const [prefs,setPrefsState]=useState<Prefs>(defaults); const ctx=useRef<AudioContext|null>(null); const unread=useRef(0); const baseTitle=useRef("Bakers Whisper — WoW Whisper Chat");
 useEffect(()=>{try{setPrefsState({...defaults,...JSON.parse(localStorage.getItem(KEY)||"{}")})}catch{} const unlock=()=>{ctx.current??=new AudioContext();void ctx.current.resume()}; addEventListener("click",unlock,{once:true});addEventListener("keydown",unlock,{once:true}); const visible=()=>{if(document.visibilityState==="visible"){unread.current=0;document.title=baseTitle.current}};document.addEventListener("visibilitychange",visible);return()=>document.removeEventListener("visibilitychange",visible)},[]);
 const setPrefs=(next:Prefs)=>{setPrefsState(next);localStorage.setItem(KEY,JSON.stringify(next))};
 const playChime=useCallback(()=>{try{ctx.current??=new AudioContext();const audio=ctx.current;const play=(frequency:number,start:number,duration:number)=>{const osc=audio.createOscillator(),gain=audio.createGain();osc.type="sine";osc.frequency.value=frequency;gain.gain.setValueAtTime(.0001,audio.currentTime+start);gain.gain.linearRampToValueAtTime(.6*prefs.volume,audio.currentTime+start+.01);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+start+duration);osc.connect(gain).connect(audio.destination);osc.start(audio.currentTime+start);osc.stop(audio.currentTime+start+duration)};play(880,0,.12);play(1318.5,.12,.09)}catch{}},[prefs.volume]);
 const requestDesktop=async()=>{if("Notification" in window) return await Notification.requestPermission();return "denied" as NotificationPermission};
 const notifyIncoming=useCallback((message:{player:string;character:string;body:string})=>{if(prefs.sound)playChime();if(prefs.desktop&&"Notification"in window&&Notification.permission==="granted"&&document.visibilityState!=="visible")new Notification(`Whisper de ${message.player}`,{body:`[${message.character}] ${message.body}`,tag:`bw-${message.character}-${message.player}`});if(document.visibilityState!=="visible"){unread.current++;document.title=`(${unread.current}) ${baseTitle.current}`}},[prefs.desktop,prefs.sound,playChime]);
 return{prefs,setPrefs,playChime,requestDesktop,notifyIncoming};
}
