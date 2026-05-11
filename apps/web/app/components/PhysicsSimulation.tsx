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

const OBSTACLE_COLORS = {
  peg: "#FF6B6B",
  rotatingBar: "#4ECDC4",
  triangle: "#FFEAA7",
  platform: "#96CEB4",
  movingBlock: "#DDA0DD",
  floatingOrb: "#85C1E9",
  pendulum: "#BB8FCE",
  elevator: "#F7DC6F",
};

function getRandomColor(): string {
  return BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)] ?? "#FF6B6B";
}

function getRandomSize(): number {
  return 12 + Math.random() * 16;
}

function getRandomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface MovingObject {
  body: Matter.Body;
  type: "movingBlock" | "floatingOrb" | "pendulum" | "elevator";
  createdAt: number;
  lifetime: number;
  anchor?: { x: number; y: number };
  constraint?: Matter.Constraint;
  startPos: { x: number; y: number };
  speed: number;
  amplitude: number;
  phase: number;
  axis: "x" | "y" | "both" | "circular";
  trail: { x: number; y: number }[];
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
  const staticObstaclesRef = useRef<Matter.Body[]>([]);
  const movingObjectsRef = useRef<MovingObject[]>([]);

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

  const removeMovingObject = useCallback((obj: MovingObject) => {
    const engine = engineRef.current;
    if (!engine) return;

    Matter.Composite.remove(engine.world, obj.body);
    if (obj.constraint) {
      Matter.Composite.remove(engine.world, obj.constraint);
    }
    movingObjectsRef.current = movingObjectsRef.current.filter((m) => m !== obj);
  }, []);

  const cleanupExpiredMovingObjects = useCallback(() => {
    const now = Date.now();
    const toRemove = movingObjectsRef.current.filter(
      (obj) => now - obj.createdAt > obj.lifetime
    );
    toRemove.forEach((obj) => removeMovingObject(obj));
  }, [removeMovingObject]);

  const createStaticObstacles = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Clear existing static obstacles
    staticObstaclesRef.current.forEach((obs) => {
      Matter.Composite.remove(engine.world, obs);
    });
    staticObstaclesRef.current = [];

    const obstacles: Matter.Body[] = [];

    // Pegs / Bumpers - scattered like pinball
    const pegRows = 5;
    const pegCols = 8;
    const pegSpacingX = width / (pegCols + 1);
    const pegSpacingY = height / (pegRows + 2);

    for (let row = 1; row <= pegRows; row++) {
      for (let col = 1; col <= pegCols; col++) {
        const offsetX = row % 2 === 0 ? pegSpacingX / 2 : 0;
        const x = col * pegSpacingX + offsetX;
        const y = row * pegSpacingY + height * 0.15;

        if (x > 50 && x < width - 50 && y > 50 && y < height - 50) {
          const peg = Matter.Bodies.circle(x, y, 10, {
            isStatic: true,
            restitution: 0.9,
            friction: 0,
            render: {
              fillStyle: OBSTACLE_COLORS.peg,
              strokeStyle: "#FF4757",
              lineWidth: 2,
            },
          });
          obstacles.push(peg);
        }
      }
    }

    // Rotating Bars
    const barCount = 3;
    for (let i = 0; i < barCount; i++) {
      const x = width * 0.2 + (width * 0.6 * i) / (barCount - 1 || 1);
      const y = height * 0.35 + Math.random() * height * 0.2;
      const bar = Matter.Bodies.rectangle(x, y, 140, 14, {
        isStatic: true,
        restitution: 0.7,
        angle: Math.random() * Math.PI,
        render: {
          fillStyle: OBSTACLE_COLORS.rotatingBar,
          strokeStyle: "#26D0CE",
          lineWidth: 2,
        },
      });
      // Store rotation speed in a custom property
      (bar as unknown as Record<string, unknown>).rotationSpeed =
        (Math.random() - 0.5) * 0.03;
      obstacles.push(bar);
    }

    // Triangle Wedges
    const trianglePositions = [
      { x: width * 0.15, y: height * 0.6 },
      { x: width * 0.85, y: height * 0.6 },
      { x: width * 0.5, y: height * 0.75 },
    ];

    trianglePositions.forEach((pos) => {
      const triangle = Matter.Bodies.polygon(pos.x, pos.y, 3, 40, {
        isStatic: true,
        restitution: 0.8,
        angle: Math.random() * Math.PI,
        render: {
          fillStyle: OBSTACLE_COLORS.triangle,
          strokeStyle: "#FDCB6E",
          lineWidth: 2,
        },
      });
      obstacles.push(triangle);
    });

    // Platform Shelves
    const platformCount = 4;
    for (let i = 0; i < platformCount; i++) {
      const x = width * 0.15 + Math.random() * width * 0.7;
      const y = height * 0.5 + (i * height * 0.12);
      const platform = Matter.Bodies.rectangle(x, y, 100 + Math.random() * 80, 12, {
        isStatic: true,
        restitution: 0.3,
        friction: 0.5,
        angle: (Math.random() - 0.5) * 0.3,
        render: {
          fillStyle: OBSTACLE_COLORS.platform,
          strokeStyle: "#55EFC4",
          lineWidth: 2,
        },
      });
      obstacles.push(platform);
    }

    staticObstaclesRef.current = obstacles;
    Matter.Composite.add(engine.world, obstacles);
  }, []);

  const getSafeSpawnPosition = useCallback((): { x: number; y: number } | null => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const margin = 80;

    for (let attempts = 0; attempts < 20; attempts++) {
      const x = margin + Math.random() * (width - margin * 2);
      const y = margin + Math.random() * (height * 0.7);

      let overlap = false;
      for (const obj of movingObjectsRef.current) {
        const dx = obj.body.position.x - x;
        const dy = obj.body.position.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 80) {
          overlap = true;
          break;
        }
      }

      // Also check spreadsheet body
      const rect = getSpreadsheetRect();
      if (rect) {
        const sx = rect.left + rect.width / 2;
        const sy = rect.top + rect.height / 2;
        if (
          Math.abs(x - sx) < rect.width / 2 + 60 &&
          Math.abs(y - sy) < rect.height / 2 + 60
        ) {
          overlap = true;
        }
      }

      if (!overlap) {
        return { x, y };
      }
    }
    return null;
  }, [getSpreadsheetRect]);

  const spawnMovingObject = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const types: MovingObject["type"][] = ["movingBlock", "floatingOrb", "pendulum", "elevator"];
    const type = types[Math.floor(Math.random() * types.length)] ?? "movingBlock";
    const pos = getSafeSpawnPosition();
    if (!pos) return;

    const lifetime = getRandomRange(15000, 30000);
    const speed = getRandomRange(0.0008, 0.002);
    const amplitude = getRandomRange(80, 200);
    const phase = Math.random() * Math.PI * 2;

    let body!: Matter.Body;
    let constraint: Matter.Constraint | undefined;
    let axis!: MovingObject["axis"];
    let anchor: { x: number; y: number } | undefined;

    switch (type) {
      case "movingBlock": {
        const w = 40 + Math.random() * 40;
        const h = 40 + Math.random() * 40;
        body = Matter.Bodies.rectangle(pos.x, pos.y, w, h, {
          restitution: 0.6,
          friction: 0.3,
          frictionAir: 0.02,
          density: 0.005,
          render: {
            fillStyle: OBSTACLE_COLORS.movingBlock,
            strokeStyle: "#E17055",
            lineWidth: 2,
          },
        });
        axis = Math.random() > 0.5 ? "x" : "y";
        break;
      }
      case "floatingOrb": {
        const radius = 15 + Math.random() * 15;
        body = Matter.Bodies.circle(pos.x, pos.y, radius, {
          restitution: 0.7,
          friction: 0.1,
          frictionAir: 0.02,
          density: 0.003,
          render: {
            fillStyle: OBSTACLE_COLORS.floatingOrb,
            strokeStyle: "#74B9FF",
            lineWidth: 2,
          },
        });
        axis = "circular";
        break;
      }
      case "pendulum": {
        const barW = 100 + Math.random() * 60;
        const barH = 12;
        body = Matter.Bodies.rectangle(pos.x, pos.y, barW, barH, {
          restitution: 0.7,
          friction: 0.1,
          frictionAir: 0.01,
          density: 0.008,
          render: {
            fillStyle: OBSTACLE_COLORS.pendulum,
            strokeStyle: "#A29BFE",
            lineWidth: 2,
          },
        });
        anchor = { x: pos.x, y: pos.y - 120 };
        constraint = Matter.Constraint.create({
          pointA: anchor,
          bodyB: body,
          length: 120,
          stiffness: 0.9,
          damping: 0.1,
          render: {
            visible: true,
            strokeStyle: "rgba(187, 143, 206, 0.4)",
            lineWidth: 2,
          },
        });
        axis = "both";
        break;
      }
      case "elevator": {
        const w = 80 + Math.random() * 60;
        const h = 12;
        body = Matter.Bodies.rectangle(pos.x, pos.y, w, h, {
          restitution: 0.3,
          friction: 0.5,
          frictionAir: 0.05,
          density: 0.01,
          render: {
            fillStyle: OBSTACLE_COLORS.elevator,
            strokeStyle: "#FDCB6E",
            lineWidth: 2,
          },
        });
        axis = "y";
        break;
      }
    }

    if (!body) return;

    Matter.Composite.add(engine.world, body);
    if (constraint) {
      Matter.Composite.add(engine.world, constraint);
    }

    const movingObj: MovingObject = {
      body,
      type,
      createdAt: Date.now(),
      lifetime,
      anchor,
      constraint,
      startPos: { x: pos.x, y: pos.y },
      speed,
      amplitude,
      phase,
      axis,
      trail: [],
    };

    movingObjectsRef.current.push(movingObj);
  }, [getSafeSpawnPosition]);

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
    createStaticObstacles();

    const runner = Matter.Runner.create();
    runnerRef.current = runner;

    Matter.Render.run(render);
    Matter.Runner.run(runner, engine);

    // Spawn balls every 1-2 seconds
    spawnIntervalRef.current = setInterval(() => {
      const x = Math.random() * window.innerWidth;
      createBall(x, -40);
    }, 1000 + Math.random() * 1000);

    // Spawn moving objects every 3-8 seconds
    const movingSpawnInterval = setInterval(() => {
      spawnMovingObject();
    }, getRandomRange(3000, 8000));

    // Cleanup offscreen balls periodically
    const cleanupInterval = setInterval(cleanupOffscreenBalls, 2000);

    // Cleanup expired moving objects
    const movingCleanupInterval = setInterval(cleanupExpiredMovingObjects, 1000);

    // Sync spreadsheet body position
    const syncInterval = setInterval(() => {
      updateSpreadsheetBody();
    }, 200);

    // Animate obstacles and moving objects
    const handleBeforeUpdate = () => {
      const time = engine.timing.timestamp;

      // Rotate bars slowly
      staticObstaclesRef.current.forEach((body) => {
        const custom = body as unknown as Record<string, unknown>;
        if (typeof custom.rotationSpeed === "number") {
          Matter.Body.setAngle(body, body.angle + custom.rotationSpeed);
        }
      });

      // Animate moving objects
      movingObjectsRef.current.forEach((obj) => {
        const t = time * obj.speed + obj.phase;

        switch (obj.type) {
          case "movingBlock": {
            if (obj.axis === "x") {
              const newX = obj.startPos.x + Math.sin(t) * obj.amplitude;
              Matter.Body.setPosition(obj.body, {
                x: newX,
                y: obj.body.position.y,
              });
              Matter.Body.setVelocity(obj.body, { x: 0, y: obj.body.velocity.y });
            } else {
              const newY = obj.startPos.y + Math.sin(t) * obj.amplitude;
              Matter.Body.setPosition(obj.body, {
                x: obj.body.position.x,
                y: newY,
              });
              Matter.Body.setVelocity(obj.body, { x: obj.body.velocity.x, y: 0 });
            }
            break;
          }
          case "floatingOrb": {
            const newX = obj.startPos.x + Math.sin(t) * obj.amplitude;
            const newY = obj.startPos.y + Math.cos(t * 0.7) * obj.amplitude * 0.6;
            Matter.Body.setPosition(obj.body, { x: newX, y: newY });
            Matter.Body.setVelocity(obj.body, { x: 0, y: 0 });
            break;
          }
          case "pendulum": {
            const swingAngle = Math.sin(t) * 0.6;
            if (obj.anchor) {
              const pivotX = obj.anchor.x;
              const pivotY = obj.anchor.y;
              const length = 120;
              const newX = pivotX + Math.sin(swingAngle) * length;
              const newY = pivotY + Math.cos(swingAngle) * length;
              Matter.Body.setPosition(obj.body, { x: newX, y: newY });
              Matter.Body.setAngle(obj.body, swingAngle);
              Matter.Body.setVelocity(obj.body, { x: 0, y: 0 });
              Matter.Body.setAngularVelocity(obj.body, 0);
            }
            break;
          }
          case "elevator": {
            const newY = obj.startPos.y + Math.sin(t) * obj.amplitude;
            Matter.Body.setPosition(obj.body, {
              x: obj.body.position.x,
              y: newY,
            });
            Matter.Body.setVelocity(obj.body, { x: obj.body.velocity.x, y: 0 });
            break;
          }
        }

        // Update trail
        obj.trail.push({ x: obj.body.position.x, y: obj.body.position.y });
        if (obj.trail.length > 20) {
          obj.trail.shift();
        }
      });
    };

    Matter.Events.on(engine, "beforeUpdate", handleBeforeUpdate);

    // Custom rendering for trails and glow
    const handleAfterRender = () => {
      const ctx = render.context;

      movingObjectsRef.current.forEach((obj) => {
        if (obj.trail.length < 2) return;

        ctx.beginPath();
        const first = obj.trail[0]!;
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < obj.trail.length; i++) {
          const pt = obj.trail[i]!;
          ctx.lineTo(pt.x, pt.y);
        }

        let strokeColor = "rgba(255, 255, 255, 0.2)";
        switch (obj.type) {
          case "movingBlock":
            strokeColor = "rgba(221, 160, 221, 0.3)";
            break;
          case "floatingOrb":
            strokeColor = "rgba(133, 193, 233, 0.3)";
            break;
          case "pendulum":
            strokeColor = "rgba(187, 143, 206, 0.3)";
            break;
          case "elevator":
            strokeColor = "rgba(247, 220, 111, 0.3)";
            break;
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.stroke();

        // Glow effect on moving objects
        const pos = obj.body.position;
        const gradient = ctx.createRadialGradient(pos.x, pos.y, 5, pos.x, pos.y, 40);
        let glowColor = "rgba(255, 255, 255, 0.1)";
        switch (obj.type) {
          case "movingBlock":
            glowColor = "rgba(221, 160, 221, 0.15)";
            break;
          case "floatingOrb":
            glowColor = "rgba(133, 193, 233, 0.15)";
            break;
          case "pendulum":
            glowColor = "rgba(187, 143, 206, 0.15)";
            break;
          case "elevator":
            glowColor = "rgba(247, 220, 111, 0.15)";
            break;
        }
        gradient.addColorStop(0, glowColor);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 40, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    Matter.Events.on(render, "afterRender", handleAfterRender);

    const handleResize = () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      render.canvas.width = newWidth;
      render.canvas.height = newHeight;
      render.options.width = newWidth;
      render.options.height = newHeight;

      updateWalls();
      updateSpreadsheetBody();
      createStaticObstacles();
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
      clearInterval(movingSpawnInterval);
      clearInterval(cleanupInterval);
      clearInterval(movingCleanupInterval);
      clearInterval(syncInterval);

      Matter.Events.off(engine, "beforeUpdate", handleBeforeUpdate);
      Matter.Events.off(render, "afterRender", handleAfterRender);

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
      staticObstaclesRef.current = [];
      movingObjectsRef.current = [];
    };
  }, [
    createBall,
    cleanupOffscreenBalls,
    updateSpreadsheetBody,
    updateWalls,
    createStaticObstacles,
    spawnMovingObject,
    cleanupExpiredMovingObjects,
  ]);

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
