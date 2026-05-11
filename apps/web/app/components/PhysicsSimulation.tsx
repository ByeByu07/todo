"use client";

import { useEffect, useRef, useCallback } from "react";
import Matter from "matter-js";

const BALL_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
];

function getRandomColor(): string {
  return (
    BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)] ?? "#FF6B6B"
  );
}

function getRandomSize(): number {
  return 12 + Math.random() * 16; // 12px to 28px radius
}

interface TrailPoint {
  x: number;
  y: number;
  color: string;
  radius: number;
  alpha: number;
}

export default function PhysicsSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const spawnIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bodiesRef = useRef<Matter.Body[]>([]);
  const spreadsheetBodyRef = useRef<Matter.Body | null>(null);
  const wallsRef = useRef<Matter.Body[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const trailsRef = useRef<TrailPoint[]>([]);

  const createBall = useCallback((x: number, y: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    const radius = getRandomSize();
    const color = getRandomColor();
    const ball = Matter.Bodies.circle(x, y, radius, {
      restitution: 0.6 + Math.random() * 0.2,
      friction: 0.01,
      frictionAir: 0.01,
      render: {
        fillStyle: color,
      },
    });

    // Attach color to body for trail rendering
    (ball as unknown as Record<string, unknown>).trailColor = color;
    (ball as unknown as Record<string, unknown>).trailRadius = radius;

    Matter.Composite.add(engine.world, ball);
    bodiesRef.current.push(ball);
  }, []);

  const getSpreadsheetRect = useCallback((): DOMRect | null => {
    const iframe = document.querySelector('iframe[title*="Spreadsheet"]');
    if (!iframe) return null;
    return iframe.getBoundingClientRect();
  }, []);

  const updateSpreadsheetBody = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const rect = getSpreadsheetRect();
    if (!rect) {
      if (spreadsheetBodyRef.current) {
        Matter.Composite.remove(engine.world, spreadsheetBodyRef.current);
        spreadsheetBodyRef.current = null;
      }
      return;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (spreadsheetBodyRef.current) {
      const current = spreadsheetBodyRef.current;
      // If dimensions changed significantly, recreate the body
      const widthDiff = Math.abs(current.bounds.max.x - current.bounds.min.x - rect.width);
      const heightDiff = Math.abs(current.bounds.max.y - current.bounds.min.y - rect.height);
      if (widthDiff > 2 || heightDiff > 2) {
        Matter.Composite.remove(engine.world, current);
        const body = Matter.Bodies.rectangle(
          centerX,
          centerY,
          rect.width,
          rect.height,
          {
            isStatic: true,
            render: {
              fillStyle: "transparent",
              strokeStyle: "transparent",
              lineWidth: 0,
            },
          }
        );
        spreadsheetBodyRef.current = body;
        Matter.Composite.add(engine.world, body);
      } else {
        Matter.Body.setPosition(current, {
          x: centerX,
          y: centerY,
        });
      }
    } else {
      const body = Matter.Bodies.rectangle(
        centerX,
        centerY,
        rect.width,
        rect.height,
        {
          isStatic: true,
          render: {
            fillStyle: "transparent",
            strokeStyle: "transparent",
            lineWidth: 0,
          },
        }
      );
      spreadsheetBodyRef.current = body;
      Matter.Composite.add(engine.world, body);
    }
  }, [getSpreadsheetRect]);

  const updateWalls = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const wallThickness = 100;

    wallsRef.current.forEach((wall) => {
      Matter.Composite.remove(engine.world, wall);
    });
    wallsRef.current = [];

    // Left and right walls only — bottom is open so balls can fall off
    const leftWall = Matter.Bodies.rectangle(
      -wallThickness / 2,
      height / 2,
      wallThickness,
      height * 2,
      { isStatic: true, render: { visible: false } }
    );
    const rightWall = Matter.Bodies.rectangle(
      width + wallThickness / 2,
      height / 2,
      wallThickness,
      height * 2,
      { isStatic: true, render: { visible: false } }
    );

    wallsRef.current = [leftWall, rightWall];
    Matter.Composite.add(engine.world, wallsRef.current);
  }, []);

  const cleanupOffscreenBalls = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const height = window.innerHeight;
    const toRemove: Matter.Body[] = [];

    bodiesRef.current = bodiesRef.current.filter((body) => {
      if (body.position.y > height + 150) {
        toRemove.push(body);
        return false;
      }
      return true;
    });

    if (toRemove.length > 0) {
      Matter.Composite.remove(engine.world, toRemove);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.2, scale: 0.001 },
    });
    engineRef.current = engine;

    const render = Matter.Render.create({
      canvas,
      engine,
      options: {
        width,
        height,
        wireframes: false,
        background: "transparent",
        pixelRatio:
          typeof window !== "undefined"
            ? Math.min(window.devicePixelRatio, 2)
            : 1,
      },
    });
    renderRef.current = render;

    updateWalls();
    updateSpreadsheetBody();

    const runner = Matter.Runner.create();
    runnerRef.current = runner;

    // Trail effect: capture positions and fade them out
    Matter.Events.on(render, "afterRender", () => {
      const ctx = render.context;
      const currentTrails = trailsRef.current;

      // Fade existing trails
      for (let i = currentTrails.length - 1; i >= 0; i--) {
        const trail = currentTrails[i];
        if (!trail) continue;
        if (trail.alpha <= 0.02) {
          currentTrails.splice(i, 1);
          continue;
        }
        trail.alpha -= 0.015;
        ctx.globalAlpha = trail.alpha;
        ctx.fillStyle = trail.color;
        ctx.beginPath();
        ctx.arc(trail.x, trail.y, trail.radius * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Add new trail points for current balls
      for (const body of bodiesRef.current) {
        const color = (body as unknown as Record<string, string>).trailColor;
        const radius = (body as unknown as Record<string, number>).trailRadius;
        if (color && radius) {
          currentTrails.push({
            x: body.position.x,
            y: body.position.y,
            color,
            radius,
            alpha: 0.25,
          });
        }
      }
    });

    Matter.Render.run(render);
    Matter.Runner.run(runner, engine);

    // Spawn balls every 1-2 seconds
    spawnIntervalRef.current = setInterval(() => {
      const x = Math.random() * window.innerWidth;
      createBall(x, -40);
    }, 1000 + Math.random() * 1000);

    // Cleanup offscreen balls periodically
    const cleanupInterval = setInterval(cleanupOffscreenBalls, 2000);

    // Sync spreadsheet body position/size using ResizeObserver
    const iframe = document.querySelector('iframe[title*="Spreadsheet"]');
    if (iframe) {
      const ro = new ResizeObserver(() => {
        updateSpreadsheetBody();
      });
      ro.observe(iframe);
      resizeObserverRef.current = ro;
    }

    const handleResize = () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      render.canvas.width = newWidth;
      render.canvas.height = newHeight;
      render.options.width = newWidth;
      render.options.height = newHeight;

      updateWalls();
      updateSpreadsheetBody();
    };

    const handlePointerDown = (e: PointerEvent) => {
      // Only spawn if not clicking on interactive elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === "IFRAME" ||
        target.tagName === "BUTTON" ||
        target.tagName === "A" ||
        target.tagName === "INPUT" ||
        target.isContentEditable
      ) {
        return;
      }
      createBall(e.clientX, e.clientY);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointerdown", handlePointerDown);

      if (spawnIntervalRef.current) {
        clearInterval(spawnIntervalRef.current);
      }
      clearInterval(cleanupInterval);

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      // Remove all dynamic bodies before clearing engine
      const allBodies = bodiesRef.current.slice();
      if (allBodies.length > 0) {
        Matter.Composite.remove(engine.world, allBodies);
      }
      if (spreadsheetBodyRef.current) {
        Matter.Composite.remove(engine.world, spreadsheetBodyRef.current);
      }
      wallsRef.current.forEach((wall) => {
        Matter.Composite.remove(engine.world, wall);
      });

      Matter.Events.off(render, "afterRender");
      Matter.Runner.stop(runner);
      Matter.Render.stop(render);
      Matter.Engine.clear(engine);

      engineRef.current = null;
      runnerRef.current = null;
      renderRef.current = null;
      bodiesRef.current = [];
      wallsRef.current = [];
      spreadsheetBodyRef.current = null;
      trailsRef.current = [];
    };
  }, [createBall, cleanupOffscreenBalls, updateSpreadsheetBody, updateWalls]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
