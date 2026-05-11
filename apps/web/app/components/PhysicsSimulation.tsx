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
  return BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)] ?? "#FF6B6B";
}

function getRandomSize(): number {
  return 12 + Math.random() * 16; // 12px to 28px radius
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

  const createBall = useCallback((x: number, y: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    const radius = getRandomSize();
    const ball = Matter.Bodies.circle(x, y, radius, {
      restitution: 0.6 + Math.random() * 0.2,
      friction: 0.01,
      frictionAir: 0.01,
      render: {
        fillStyle: getRandomColor(),
      },
    });

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
      Matter.Body.setPosition(spreadsheetBodyRef.current, {
        x: centerX,
        y: centerY,
      });
    } else {
      const body = Matter.Bodies.rectangle(centerX, centerY, rect.width, rect.height, {
        isStatic: true,
        render: {
          fillStyle: "transparent",
          strokeStyle: "transparent",
          lineWidth: 0,
        },
      });
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
    const bottomWall = Matter.Bodies.rectangle(
      width / 2,
      height + wallThickness / 2 + 200,
      width * 2,
      wallThickness,
      { isStatic: true, render: { visible: false } }
    );

    wallsRef.current = [leftWall, rightWall, bottomWall];
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
        pixelRatio: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
      },
    });
    renderRef.current = render;

    updateWalls();
    updateSpreadsheetBody();

    const runner = Matter.Runner.create();
    runnerRef.current = runner;

    Matter.Render.run(render);
    Matter.Runner.run(runner, engine);

    // Spawn balls every 1-2 seconds
    spawnIntervalRef.current = setInterval(() => {
      const x = Math.random() * window.innerWidth;
      createBall(x, -40);
    }, 1000 + Math.random() * 1000);

    // Cleanup offscreen balls periodically
    const cleanupInterval = setInterval(cleanupOffscreenBalls, 2000);

    // Sync spreadsheet body position
    const syncInterval = setInterval(() => {
      updateSpreadsheetBody();
    }, 200);

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

    const handleClick = (e: MouseEvent) => {
      createBall(e.clientX, e.clientY);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("click", handleClick);

      if (spawnIntervalRef.current) {
        clearInterval(spawnIntervalRef.current);
      }
      clearInterval(cleanupInterval);
      clearInterval(syncInterval);

      Matter.Runner.stop(runner);
      Matter.Render.stop(render);
      Matter.Engine.clear(engine);

      if (render.canvas) {
        render.canvas.remove();
      }

      engineRef.current = null;
      runnerRef.current = null;
      renderRef.current = null;
      bodiesRef.current = [];
      wallsRef.current = [];
      spreadsheetBodyRef.current = null;
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
