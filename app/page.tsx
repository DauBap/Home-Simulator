"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  CapsuleCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
  useRapier,
} from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Euler,
  MathUtils,
  type Group,
  Matrix3,
  type Object3D,
  Vector2,
  Vector3,
} from "three";

const PLAYER_SPEED = 5;
const JUMP_SPEED = 5.5;
const PLAYER_EYE_HEIGHT = 0.55;
const GROUND_RAY_ORIGIN_OFFSET = 0.8;
const GROUND_RAY_LENGTH = 0.35;
const MOUSE_SENSITIVITY = 0.002;
const MAX_LOOK_ANGLE = Math.PI / 2 - 0.02;

type BoxSize = [number, number, number];
type WorldPosition = [number, number, number];
type FurnitureId = "chair" | "table" | "plant";

type FurnitureDefinition = {
  name: string;
  description: string;
  size: BoxSize;
  color: string;
  support?: {
    size: [number, number];
    height: number;
  };
  supportPoints?: Array<[number, number]>;
};

type PlacedFurniture = {
  id: string;
  type: FurnitureId;
  position: WorldPosition;
  rotation: number;
};

const FURNITURE: Record<FurnitureId, FurnitureDefinition> = {
  chair: {
    name: "Ghế",
    description: "Ghế gỗ",
    size: [0.8, 1.45, 0.8],
    color: "#9b7653",
    support: { size: [0.8, 0.8], height: 0.69 },
    supportPoints: [
      [-0.3, -0.3],
      [-0.3, 0.3],
      [0.3, -0.3],
      [0.3, 0.3],
    ],
  },
  table: {
    name: "Bàn",
    description: "Bàn nhỏ",
    size: [1.4, 1.05, 0.9],
    color: "#b17e4c",
    support: { size: [1.4, 0.9], height: 1.03 },
  },
  plant: {
    name: "Chậu cây",
    description: "Cây trang trí",
    size: [0.7, 1.2, 0.7],
    color: "#63885d",
  },
};

const ROOM_OBSTACLES: Array<{ position: WorldPosition; size: BoxSize }> = [
  { position: [2, 0.65, 0], size: [1.6, 1.3, 1.2] },
  { position: [-3, 0.5, -2], size: [1.2, 1, 1.2] },
  { position: [3, 0.4, 1], size: [1.4, 0.8, 1.4] },
];

function Player() {
  const body = useRef<RapierRigidBody>(null);
  const keys = useRef<Record<string, boolean>>({});
  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const up = useRef(new Vector3(0, 1, 0));
  const jumpPressed = useRef(false);
  const { camera } = useThree();
  const { rapier, world } = useRapier();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      keys.current[event.code] = true;
      if (event.code === "Space" && !event.repeat) {
        jumpPressed.current = true;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      keys.current[event.code] = false;
    };
    const clearKeys = () => {
      keys.current = {};
      jumpPressed.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearKeys);
    };
  }, []);

  useFrame((_, delta) => {
    const player = body.current;
    if (!player) return;

    const position = player.translation();
    const feetRay = new rapier.Ray(
      {
        x: position.x,
        y: position.y - GROUND_RAY_ORIGIN_OFFSET,
        z: position.z,
      },
      { x: 0, y: -1, z: 0 },
    );
    const grounded = world.castRay(
      feetRay,
      GROUND_RAY_LENGTH,
      true,
      undefined,
      undefined,
      undefined,
      player,
    );

    if (jumpPressed.current) {
      jumpPressed.current = false;
      if (grounded) {
        player.setLinvel(
          { x: player.linvel().x, y: JUMP_SPEED, z: player.linvel().z },
          true,
        );
      }
    }

    const direction = forward.current;
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    right.current.crossVectors(direction, up.current).normalize();

    const moveX =
      Number(Boolean(keys.current.KeyD)) -
      Number(Boolean(keys.current.KeyA));
    const moveZ =
      Number(Boolean(keys.current.KeyW)) -
      Number(Boolean(keys.current.KeyS));
    const inputLength = Math.hypot(moveX, moveZ);
    const velocity = player.linvel();
    let targetX = 0;
    let targetZ = 0;

    if (inputLength > 0) {
      const normalizedX = moveX / inputLength;
      const normalizedZ = moveZ / inputLength;
      targetX =
        (right.current.x * normalizedX + direction.x * normalizedZ) *
        PLAYER_SPEED;
      targetZ =
        (right.current.z * normalizedX + direction.z * normalizedZ) *
        PLAYER_SPEED;
    }

    player.setLinvel(
      {
        x: MathUtils.damp(velocity.x, targetX, 14, delta),
        y: velocity.y,
        z: MathUtils.damp(velocity.z, targetZ, 14, delta),
      },
      true,
    );

    const cameraPosition = player.translation();
    camera.position.set(
      cameraPosition.x,
      cameraPosition.y + PLAYER_EYE_HEIGHT,
      cameraPosition.z,
    );
  });

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={[0, 1, 4]}
      mass={1}
      lockRotations
      linearDamping={0.5}
      friction={0}
    >
      <CapsuleCollider args={[0.55, 0.3]} />
    </RigidBody>
  );
}

function MouseLook({
  fallbackEnabled,
  requestMouseLock,
}: {
  fallbackEnabled: boolean;
  requestMouseLock: () => void;
}) {
  const { camera, gl } = useThree();
  const euler = useRef(new Euler(0, 0, 0, "YXZ"));

  useEffect(() => {
    const canvas = gl.domElement;
    const document = gl.domElement.ownerDocument;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const rotateCamera = (deltaX: number, deltaY: number) => {
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= deltaX * MOUSE_SENSITIVITY;
      euler.current.x = MathUtils.clamp(
        euler.current.x - deltaY * MOUSE_SENSITIVITY,
        -MAX_LOOK_ANGLE,
        MAX_LOOK_ANGLE,
      );
      camera.quaternion.setFromEuler(euler.current);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        rotateCamera(event.movementX, event.movementY);
        return;
      }

      if (!dragging || !fallbackEnabled) return;
      rotateCamera(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || document.pointerLockElement === canvas) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      if (!fallbackEnabled) requestMouseLock();
    };
    const handlePointerUp = () => {
      dragging = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [camera, fallbackEnabled, gl, requestMouseLock]);

  return null;
}

function FurnitureModel({
  type,
  ghost = false,
  valid = true,
}: {
  type: FurnitureId;
  ghost?: boolean;
  valid?: boolean;
}) {
  const ghostColor = valid ? "#63e88c" : "#f05252";
  const material = (color: string) => ({
    color: ghost ? ghostColor : color,
    transparent: ghost,
    opacity: ghost ? 0.48 : 1,
    depthWrite: !ghost,
    roughness: 0.8,
  });

  if (type === "chair") {
    return (
      <group>
        <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.8, 0.14, 0.8]} />
          <meshStandardMaterial {...material("#b4885e")} />
        </mesh>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <mesh
              key={`${x}-${z}`}
              position={[x * 0.3, 0.3, z * 0.3]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[0.09, 0.6, 0.09]} />
              <meshStandardMaterial {...material("#765638")} />
            </mesh>
          )),
        )}
        <mesh position={[0, 1.07, -0.34]} castShadow receiveShadow>
          <boxGeometry args={[0.8, 0.9, 0.12]} />
          <meshStandardMaterial {...material("#9b7653")} />
        </mesh>
      </group>
    );
  }

  if (type === "table") {
    return (
      <group>
        <mesh position={[0, 0.96, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 0.14, 0.9]} />
          <meshStandardMaterial {...material("#b17e4c")} />
        </mesh>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <mesh
              key={`${x}-${z}`}
              position={[x * 0.58, 0.47, z * 0.33]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[0.1, 0.94, 0.1]} />
              <meshStandardMaterial {...material("#765638")} />
            </mesh>
          )),
        )}
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.3, 0.24, 0.36, 16]} />
        <meshStandardMaterial {...material("#ad7252")} />
      </mesh>
      <mesh position={[0, 0.68, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.42, 16, 12]} />
        <meshStandardMaterial {...material("#63885d")} />
      </mesh>
      <mesh position={[-0.15, 0.87, 0.06]} castShadow receiveShadow>
        <sphereGeometry args={[0.25, 12, 10]} />
        <meshStandardMaterial {...material("#769b68")} />
      </mesh>
      <mesh position={[0.17, 0.78, -0.08]} castShadow receiveShadow>
        <sphereGeometry args={[0.27, 12, 10]} />
        <meshStandardMaterial {...material("#52794e")} />
      </mesh>
    </group>
  );
}

function FixedBox({
  position,
  size,
  color,
}: {
  position: WorldPosition;
  size: BoxSize;
  color: string;
}) {
  return (
    <RigidBody type="fixed" colliders={false} position={position}>
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    </RigidBody>
  );
}

function PlacedItem({ item }: { item: PlacedFurniture }) {
  const definition = FURNITURE[item.type];

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={item.position}
      rotation={[0, item.rotation, 0]}
    >
      <CuboidCollider
        args={[
          definition.size[0] / 2,
          definition.size[1] / 2,
          definition.size[2] / 2,
        ]}
        position={[0, definition.size[1] / 2, 0]}
      />
      <group position={[0, 0, 0]}>
        <FurnitureModel type={item.type} />
      </group>
    </RigidBody>
  );
}

function isDescendantOf(object: Object3D, ancestor: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function overlaps3D(
  x: number,
  bottom: number,
  height: number,
  z: number,
  halfWidth: number,
  halfDepth: number,
  otherX: number,
  otherBottom: number,
  otherHeight: number,
  otherZ: number,
  otherHalfWidth: number,
  otherHalfDepth: number,
) {
  const horizontalOverlap =
    Math.abs(x - otherX) < halfWidth + otherHalfWidth + 0.04 &&
    Math.abs(z - otherZ) < halfDepth + otherHalfDepth + 0.04;
  const verticalOverlap =
    bottom < otherBottom + otherHeight - 0.02 &&
    bottom + height > otherBottom + 0.02;

  return horizontalOverlap && verticalOverlap;
}

type PlacementSupport = {
  x: number;
  z: number;
  top: number;
  width: number;
  depth: number;
  rotation: number;
};

function getPlacementSupport(
  point: Vector3,
  placedItems: PlacedFurniture[],
): PlacementSupport | null {
  const supports: PlacementSupport[] = [
    { x: 0, z: 0, top: 0, width: 14, depth: 14, rotation: 0 },
    ...ROOM_OBSTACLES.map(({ position, size }) => ({
      x: position[0],
      z: position[2],
      top: position[1] + size[1] / 2,
      width: size[0],
      depth: size[2],
      rotation: 0,
    })),
    ...placedItems.flatMap((item) => {
      const surface = FURNITURE[item.type].support;
      if (!surface) return [];

      return [{
        x: item.position[0],
        z: item.position[2],
        top: item.position[1] + surface.height,
        width: surface.size[0],
        depth: surface.size[1],
        rotation: item.rotation,
      }];
    }),
  ];

  return (
    supports.find((surface) => {
      if (Math.abs(point.y - surface.top) > 0.06) return false;
      const dx = point.x - surface.x;
      const dz = point.z - surface.z;
      const localX = dx * Math.cos(surface.rotation) - dz * Math.sin(surface.rotation);
      const localZ = dx * Math.sin(surface.rotation) + dz * Math.cos(surface.rotation);

      return (
        Math.abs(localX) <= surface.width / 2 &&
        Math.abs(localZ) <= surface.depth / 2
      );
    }) ?? null
  );
}

function fitPositionOnSupport(
  position: Vector3,
  rotation: number,
  size: BoxSize,
  support: PlacementSupport,
  supportPoints?: Array<[number, number]>,
) {
  const dx = position.x - support.x;
  const dz = position.z - support.z;
  let localX = dx * Math.cos(support.rotation) - dz * Math.sin(support.rotation);
  let localZ = dx * Math.sin(support.rotation) + dz * Math.cos(support.rotation);
  const relativeRotation = rotation - support.rotation;
  if (supportPoints?.length) {
    const rotatedPoints = supportPoints.map(([x, z]) => ({
      x: x * Math.cos(relativeRotation) + z * Math.sin(relativeRotation),
      z: -x * Math.sin(relativeRotation) + z * Math.cos(relativeRotation),
    }));
    const minX = Math.min(...rotatedPoints.map((point) => point.x));
    const maxX = Math.max(...rotatedPoints.map((point) => point.x));
    const minZ = Math.min(...rotatedPoints.map((point) => point.z));
    const maxZ = Math.max(...rotatedPoints.map((point) => point.z));
    if (
      maxX - minX > support.width + 0.02 ||
      maxZ - minZ > support.depth + 0.02
    ) {
      return false;
    }

    localX = MathUtils.clamp(
      localX,
      -support.width / 2 - minX,
      support.width / 2 - maxX,
    );
    localZ = MathUtils.clamp(
      localZ,
      -support.depth / 2 - minZ,
      support.depth / 2 - maxZ,
    );
    position.set(
      support.x +
        localX * Math.cos(support.rotation) +
        localZ * Math.sin(support.rotation),
      position.y,
      support.z -
        localX * Math.sin(support.rotation) +
        localZ * Math.cos(support.rotation),
    );
    return true;
  }

  const halfWidth =
    (Math.abs(Math.cos(relativeRotation)) * size[0] +
      Math.abs(Math.sin(relativeRotation)) * size[2]) /
    2;
  const halfDepth =
    (Math.abs(Math.sin(relativeRotation)) * size[0] +
      Math.abs(Math.cos(relativeRotation)) * size[2]) /
    2;

  if (
    halfWidth * 2 > support.width + 0.02 ||
    halfDepth * 2 > support.depth + 0.02
  ) {
    return false;
  }

  localX = MathUtils.clamp(
    localX,
    -support.width / 2 + halfWidth,
    support.width / 2 - halfWidth,
  );
  localZ = MathUtils.clamp(
    localZ,
    -support.depth / 2 + halfDepth,
    support.depth / 2 - halfDepth,
  );

  position.set(
    support.x +
      localX * Math.cos(support.rotation) +
      localZ * Math.sin(support.rotation),
    position.y,
    support.z -
      localX * Math.sin(support.rotation) +
      localZ * Math.cos(support.rotation),
  );
  return true;
}

function PlacementPreview({
  selectedType,
  placedItems,
  onPlace,
  canPlace,
}: {
  selectedType: FurnitureId | null;
  placedItems: PlacedFurniture[];
  onPlace: (item: PlacedFurniture) => void;
  canPlace: boolean;
}) {
  const preview = useRef<Group>(null);
  const selectedRef = useRef(selectedType);
  const placedRef = useRef(placedItems);
  const onPlaceRef = useRef(onPlace);
  const canPlaceRef = useRef(canPlace);
  const pointerDownPosition = useRef<{
    position: Vector2;
    pointerLocked: boolean;
  } | null>(null);
  const candidatePosition = useRef(new Vector3());
  const candidateRotation = useRef(0);
  const candidateValid = useRef(false);
  const previousValid = useRef(false);
  const rotationStep = useRef(0);
  const rayOrigin = useRef(new Vector2(0, 0));
  const normalMatrix = useRef(new Matrix3());
  const surfaceNormal = useRef(new Vector3());
  const { camera, gl, raycaster, scene } = useThree();
  const [isValid, setIsValid] = useState(false);

  selectedRef.current = selectedType;
  placedRef.current = placedItems;
  onPlaceRef.current = onPlace;
  canPlaceRef.current = canPlace;

  useEffect(() => {
    rotationStep.current = 0;
    candidateValid.current = false;
  }, [selectedType]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedRef.current || event.repeat) return;
      if (event.code === "KeyR") {
        event.preventDefault();
        rotationStep.current += 1;
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (!selectedRef.current) return;
      event.preventDefault();
      rotationStep.current += Math.sign(event.deltaY);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !selectedRef.current) return;
      pointerDownPosition.current = {
        position: new Vector2(event.clientX, event.clientY),
        pointerLocked: canvas.ownerDocument.pointerLockElement === canvas,
      };
    };
    const handlePointerUp = (event: PointerEvent) => {
      const start = pointerDownPosition.current;
      pointerDownPosition.current = null;
      const type = selectedRef.current;
      if (
        event.button !== 0 ||
        !type ||
        !start ||
        !start.pointerLocked ||
        !canPlaceRef.current
      ) {
        return;
      }
      const dragDistance = Math.hypot(
        event.clientX - start.position.x,
        event.clientY - start.position.y,
      );
      if (dragDistance > 5 || !candidateValid.current) return;

      event.preventDefault();
      const position = candidatePosition.current;
      onPlaceRef.current({
        id: crypto.randomUUID(),
        type,
        position: [position.x, position.y, position.z],
        rotation: candidateRotation.current,
      });
    };
    const handlePlaceKey = (event: KeyboardEvent) => {
      if (
        event.code !== "Enter" ||
        event.repeat ||
        !selectedRef.current ||
        !candidateValid.current
      ) {
        return;
      }

      event.preventDefault();
      const position = candidatePosition.current;
      onPlaceRef.current({
        id: crypto.randomUUID(),
        type: selectedRef.current,
        position: [position.x, position.y, position.z],
        rotation: candidateRotation.current,
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keydown", handlePlaceKey);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keydown", handlePlaceKey);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
    };
  }, [gl]);

  useFrame(() => {
    const type = selectedRef.current;
    const ghost = preview.current;
    if (!type || !ghost) {
      candidateValid.current = false;
      return;
    }

    raycaster.setFromCamera(rayOrigin.current, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    let target: Vector3 | null = null;
    let support: PlacementSupport | null = null;
    let baseRotation = 0;
    const definition = FURNITURE[type];

    for (const hit of hits) {
      if (
        !hit.face ||
        isDescendantOf(hit.object, ghost)
      ) {
        continue;
      }

      normalMatrix.current.getNormalMatrix(hit.object.matrixWorld);
      surfaceNormal.current
        .copy(hit.face.normal)
        .applyMatrix3(normalMatrix.current)
        .normalize();

      if (surfaceNormal.current.y > 0.5) {
        target = new Vector3(hit.point.x, hit.point.y, hit.point.z);
        support = getPlacementSupport(hit.point, placedRef.current);
        baseRotation = 0;
        break;
      }

      if (Math.abs(surfaceNormal.current.y) < 0.3) {
        const normal = surfaceNormal.current;
        const offset =
          (Math.abs(normal.x) * definition.size[0] +
            Math.abs(normal.z) * definition.size[2]) /
            2 +
          0.03;
        target = new Vector3(
          hit.point.x + normal.x * offset,
          0,
          hit.point.z + normal.z * offset,
        );
        support = getPlacementSupport(target, placedRef.current);
        baseRotation = Math.atan2(-normal.x, -normal.z);
        break;
      }
    }

    if (!target) {
      candidateValid.current = false;
      if (previousValid.current) setIsValid(false);
      previousValid.current = false;
      return;
    }

    const rotation =
      baseRotation + rotationStep.current * (Math.PI / 2);
    const halfWidth =
      (Math.abs(Math.cos(rotation)) * definition.size[0] +
        Math.abs(Math.sin(rotation)) * definition.size[2]) /
      2;
    const halfDepth =
      (Math.abs(Math.sin(rotation)) * definition.size[0] +
        Math.abs(Math.cos(rotation)) * definition.size[2]) /
      2;
    const position = candidatePosition.current.set(
      target.x,
      target.y,
      target.z,
    );
    const fitsSupport =
      support !== null &&
      fitPositionOnSupport(
        position,
        rotation,
        definition.size,
        support,
        definition.supportPoints,
      );
    const playerPosition = camera.position;
    let valid =
      fitsSupport &&
      Math.abs(position.x) + halfWidth <= 6.65 &&
      Math.abs(position.z) + halfDepth <= 6.65 &&
      !(
        Math.abs(position.x - playerPosition.x) < halfWidth + 0.45 &&
        Math.abs(position.z - playerPosition.z) < halfDepth + 0.45 &&
        position.y < playerPosition.y - PLAYER_EYE_HEIGHT + 0.85 &&
        position.y + definition.size[1] >
          playerPosition.y - PLAYER_EYE_HEIGHT - 0.85
      );

    for (const obstacle of ROOM_OBSTACLES) {
      if (
        overlaps3D(
          position.x,
          position.y,
          definition.size[1],
          position.z,
          halfWidth,
          halfDepth,
          obstacle.position[0],
          obstacle.position[1] - obstacle.size[1] / 2,
          obstacle.size[1],
          obstacle.position[2],
          obstacle.size[0] / 2,
          obstacle.size[2] / 2,
        )
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      for (const item of placedRef.current) {
        const itemSize = FURNITURE[item.type].size;
        const itemHalfWidth =
          (Math.abs(Math.cos(item.rotation)) * itemSize[0] +
            Math.abs(Math.sin(item.rotation)) * itemSize[2]) /
          2;
        const itemHalfDepth =
          (Math.abs(Math.sin(item.rotation)) * itemSize[0] +
            Math.abs(Math.cos(item.rotation)) * itemSize[2]) /
          2;
        if (
          overlaps3D(
            position.x,
            position.y,
            definition.size[1],
            position.z,
            halfWidth,
            halfDepth,
            item.position[0],
            item.position[1],
            itemSize[1],
            item.position[2],
            itemHalfWidth,
            itemHalfDepth,
          )
        ) {
          valid = false;
          break;
        }
      }
    }

    candidateRotation.current = rotation;
    candidateValid.current = valid;
    previousValid.current = valid;
    if (valid !== isValid) setIsValid(valid);

    ghost.position.copy(position);
    ghost.quaternion.setFromAxisAngle(upAxis, rotation);
  });

  if (!selectedType) return null;

  return (
    <group ref={preview}>
      <FurnitureModel type={selectedType} ghost valid={isValid} />
    </group>
  );
}

const upAxis = new Vector3(0, 1, 0);

function Room() {
  return (
    <>
      <FixedBox position={[0, -0.15, 0]} size={[14, 0.3, 14]} color="#b8b4a8" />

      <FixedBox position={[-7, 1.5, 0]} size={[0.3, 3, 14]} color="#e7e1d5" />
      <FixedBox position={[7, 1.5, 0]} size={[0.3, 3, 14]} color="#e7e1d5" />
      <FixedBox position={[0, 1.5, -7]} size={[14, 3, 0.3]} color="#e7e1d5" />
      <FixedBox position={[0, 1.5, 7]} size={[14, 3, 0.3]} color="#e7e1d5" />

      {ROOM_OBSTACLES.map(({ position, size }, index) => (
        <FixedBox
          key={index}
          position={position}
          size={size}
          color={["#9b7653", "#7b8c72", "#7f8996"][index]}
        />
      ))}
    </>
  );
}

export default function HomePage() {
  const [selectedType, setSelectedType] = useState<FurnitureId | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [placedItems, setPlacedItems] = useState<PlacedFurniture[]>([]);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  );
  const [pointerLocked, setPointerLocked] = useState(false);
  const [dragLookEnabled, setDragLookEnabled] = useState(false);
  const [pointerLockError, setPointerLockError] = useState<string | null>(null);
  const lockRequestPending = useRef(false);
  const placeItem = useCallback((item: PlacedFurniture) => {
    setPlacedItems((items) => [...items, item]);
  }, []);

  useEffect(() => {
    if (!canvasElement) return;
    const ownerDocument = canvasElement.ownerDocument;
    const handleLockChange = () => {
      const locked = ownerDocument.pointerLockElement === canvasElement;
      setPointerLocked(locked);
      if (locked) setPointerLockError(null);
    };
    const handleLockError = () => {
      setDragLookEnabled(true);
      setPointerLockError(
        "Pointer Lock không khả dụng ở trang này. Giữ chuột trái và kéo để xoay góc nhìn.",
      );
    };

    ownerDocument.addEventListener("pointerlockchange", handleLockChange);
    ownerDocument.addEventListener("pointerlockerror", handleLockError);
    return () => {
      ownerDocument.removeEventListener("pointerlockchange", handleLockChange);
      ownerDocument.removeEventListener("pointerlockerror", handleLockError);
    };
  }, [canvasElement]);

  const requestMouseLock = useCallback(async () => {
    if (!canvasElement || lockRequestPending.current || pointerLocked) return;

    lockRequestPending.current = true;
    setPointerLockError(null);
    try {
      await canvasElement.requestPointerLock();
    } catch {
      setDragLookEnabled(true);
      setPointerLockError(
        "Pointer Lock không khả dụng ở trang này. Giữ chuột trái và kéo để xoay góc nhìn.",
      );
    } finally {
      lockRequestPending.current = false;
    }
  }, [canvasElement, pointerLocked]);

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-[#dce8ef]">
      <Canvas
        shadows
        camera={{ position: [0, 1.55, 4], fov: 75 }}
        className="h-full w-full"
        onCreated={({ gl }) => setCanvasElement(gl.domElement)}
      >
        <color attach="background" args={["#dce8ef"]} />
        <ambientLight intensity={1.2} />
        <directionalLight
          castShadow
          position={[8, 12, 5]}
          intensity={2}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />

        <MouseLook
          fallbackEnabled={dragLookEnabled}
          requestMouseLock={requestMouseLock}
        />
        <Physics gravity={[0, -9.81, 0]}>
          <Player />
          <Room />
          {placedItems.map((item) => (
            <PlacedItem key={item.id} item={item} />
          ))}
          <PlacementPreview
            selectedType={selectedType}
            placedItems={placedItems}
            onPlace={placeItem}
            canPlace={pointerLocked}
          />
        </Physics>
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm text-white drop-shadow">
        WASD di chuyển · Space nhảy · R / con lăn xoay · Esc mở khóa chuột
      </div>

      {!pointerLocked && !dragLookEnabled && (
        <button
          type="button"
          onClick={requestMouseLock}
          className="absolute left-1/2 top-12 z-10 -translate-x-1/2 rounded-lg bg-slate-950/75 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-slate-900"
        >
          Khóa chuột để nhìn quanh
        </button>
      )}
      {dragLookEnabled && (
        <div className="pointer-events-none absolute left-1/2 top-12 z-10 -translate-x-1/2 rounded-lg bg-slate-950/75 px-4 py-2 text-sm font-medium text-white shadow-lg">
          Giữ chuột trái và kéo để nhìn quanh
        </div>
      )}
      {pointerLockError && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-24 z-10 w-max max-w-[min(90vw,36rem)] -translate-x-1/2 rounded-lg bg-amber-950/90 px-4 py-2 text-center text-xs text-amber-100 shadow-lg"
        >
          {pointerLockError}
        </div>
      )}

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute left-1/2 top-0 h-4 w-0.5 -translate-x-1/2 rounded bg-white shadow-[0_0_3px_1px_#000]" />
        <span className="absolute left-0 top-1/2 h-0.5 w-4 -translate-y-1/2 rounded bg-white shadow-[0_0_3px_1px_#000]" />
      </div>

      <div className="absolute bottom-5 left-5 z-10 flex flex-col items-start gap-2">
        <button
          type="button"
          aria-expanded={catalogOpen}
          aria-controls="furniture-catalog"
          onClick={() => setCatalogOpen((open) => !open)}
          className="rounded-lg border border-white/20 bg-slate-950/85 px-4 py-2 text-sm font-semibold text-white shadow-xl hover:bg-slate-900"
        >
          {catalogOpen ? "Đóng danh mục" : "Chọn đồ nội thất"}
        </button>
        {catalogOpen && (
          <section
            id="furniture-catalog"
            aria-label="Danh mục nội thất"
            className="flex gap-2 rounded-xl border border-white/20 bg-slate-950/85 p-2 text-white shadow-xl backdrop-blur"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {(Object.entries(FURNITURE) as [FurnitureId, FurnitureDefinition][]).map(
              ([type, item]) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={selectedType === type}
                  onClick={() => {
                    setSelectedType((current) =>
                      current === type ? null : type,
                    );
                    setCatalogOpen(false);
                  }}
                  className={`min-w-24 rounded-lg px-4 py-2 text-left transition ${
                    selectedType === type
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-white/10 hover:bg-white/20"
                  }`}
                >
                  <span className="block text-sm font-semibold">{item.name}</span>
                  <span className="block text-xs opacity-75">
                    {item.description}
                  </span>
                </button>
              ),
            )}
          </section>
        )}
      </div>

      {selectedType && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-xs text-white">
          {FURNITURE[selectedType].name} đang chọn · Ngắm vị trí hợp lệ rồi nhấn
          Enter để đặt
        </div>
      )}

      {placedItems.length > 0 && (
        <div className="pointer-events-none absolute right-4 top-4 rounded-md bg-black/55 px-3 py-1.5 text-xs text-white">
          Đồ đã đặt: {placedItems.length}
        </div>
      )}
    </main>
  );
}
