import { ComputedRouteOption, DailyRoutineRule, GeoLocation } from '../types/commute';

/**
 * Draws a real-time tactical map route onto a 2D canvas so that native browser
 * Video Picture-in-Picture (HTMLVideoElement.requestPictureInPicture) can display
 * the live route path, pitstop, destination, and traffic status outside the browser window.
 */
export function drawRouteToPipCanvas(
  canvas: HTMLCanvasElement,
  userLocation: GeoLocation,
  routine: DailyRoutineRule,
  selectedRoute: ComputedRouteOption | null,
  headingTitle: string
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // Dark map background
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, w, h);

  // Subtle street grid lines
  ctx.strokeStyle = '#141e30';
  ctx.lineWidth = 1;
  const gridStep = 36;
  for (let x = 0; x < w; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Collect coordinates to compute bounding box
  const points: GeoLocation[] = [];
  if (selectedRoute && selectedRoute.pathCoordinates.length > 0) {
    points.push(...selectedRoute.pathCoordinates);
  } else {
    points.push(userLocation);
    if (routine.includePitstopInRoute && routine.preferredPitstop) {
      points.push(routine.preferredPitstop.location);
    }
    if (routine.destination) {
      points.push(routine.destination.location);
    }
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  points.forEach((pt) => {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  });

  const latSpan = Math.max(0.005, maxLat - minLat);
  const lngSpan = Math.max(0.005, maxLng - minLng);

  const padX = 48;
  const padTop = 54;
  const padBottom = 46;
  const drawW = w - padX * 2;
  const drawH = h - padTop - padBottom;

  const project = (loc: GeoLocation): [number, number] => {
    const x = padX + ((loc.lng - minLng) / lngSpan) * drawW;
    const y = padTop + (1 - (loc.lat - minLat) / latSpan) * drawH;
    return [x, y];
  };

  // Draw route polyline
  if (selectedRoute && selectedRoute.pathCoordinates.length > 1) {
    // Outer glow
    ctx.save();
    ctx.beginPath();
    selectedRoute.pathCoordinates.forEach((pt, idx) => {
      const [x, y] = project(pt);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle =
      selectedRoute.trafficCondition === 'HEAVY'
        ? 'rgba(245, 158, 11, 0.28)'
        : 'rgba(59, 130, 246, 0.28)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Main route line
    ctx.beginPath();
    selectedRoute.pathCoordinates.forEach((pt, idx) => {
      const [x, y] = project(pt);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle =
      selectedRoute.trafficCondition === 'HEAVY' ? '#f59e0b' : '#3b82f6';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Draw Pitstop node if active
  if (routine.includePitstopInRoute && routine.preferredPitstop) {
    const [px, py] = project(routine.preferredPitstop.location);
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw Destination node
  if (routine.destination) {
    const [dx, dy] = project(routine.destination.location);
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(dx, dy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Draw User Live Position node
  const [ux, uy] = project(userLocation);
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(ux, uy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Top translucent HUD bar
  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
  ctx.fillRect(0, 0, w, 38);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px sans-serif';
  const targetLabel =
    routine.includePitstopInRoute && routine.preferredPitstop
      ? `${routine.preferredPitstop.displayName} → ${routine.destination?.displayName || ''}`
      : routine.destination?.displayName || headingTitle;
  ctx.fillText(targetLabel.slice(0, 38), 12, 24);

  // Bottom translucent ETA & distance HUD bar
  if (selectedRoute) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
    ctx.fillRect(0, h - 34, w, 34);
    const mins = Math.max(1, Math.round(selectedRoute.durationMillis / 60000));
    const km = (selectedRoute.distanceMeters / 1000).toFixed(1);
    ctx.fillStyle =
      selectedRoute.trafficCondition === 'HEAVY' ? '#fbbf24' : '#60a5fa';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(
      `${mins} min · ${km} km · ${
        selectedRoute.trafficCondition === 'HEAVY' ? 'Heavy Traffic' : 'Shortest Route'
      }`,
      12,
      h - 12
    );
  }
}
