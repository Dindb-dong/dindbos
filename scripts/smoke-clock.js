import assert from 'node:assert/strict';
import { createChronometer, formatDuration, nextAlarmTime, daylightPaths } from '../src/dindbos/apps/clock.js';
let now=0;
const clock=createChronometer(()=>now);
assert.equal(clock.read(),0);
clock.start(); now=1234; assert.equal(clock.read(),1234);
clock.start(); now=1500; assert.equal(clock.read(),1500,'repeat start must not reset elapsed');
clock.pause(); now=9000; assert.equal(clock.read(),1500,'pause freezes time');
clock.start(); now=10500; assert.equal(clock.read(),3000,'resume adds to prior elapsed');
clock.reset(); assert.equal(clock.running,false); assert.equal(clock.read(),0);
assert.equal(formatDuration(3723456,true),'1:02:03.45');
assert.equal(formatDuration(-1),'00:00');
console.log('clock smoke ok monotonic elapsed start/pause/resume/reset and duration formatting');

const morning=new Date(2026,10,3,6,30);
assert.equal(nextAlarmTime('07:00',morning),new Date(2026,10,3,7,0).getTime());
assert.equal(nextAlarmTime('06:00',morning),new Date(2026,10,4,6,0).getTime());
assert.throws(()=>nextAlarmTime('25:00',morning),RangeError);
for(const date of [new Date('2026-06-21T12:00:00Z'),new Date('2026-12-21T00:00:00Z')]){
 const paths=daylightPaths(date);assert(paths.line.startsWith('M'));assert(paths.night.endsWith('Z'));assert(!paths.night.includes('NaN'));
}
console.log('clock alarm next-day scheduling and daylight geometry passed');
