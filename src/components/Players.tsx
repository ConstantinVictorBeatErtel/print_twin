// Multiplayer: publishes local camera pose ~5 Hz, renders remote players lerped.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import * as THREE from "three";

const SEND_HZ = 5;

export function Players({ room, sessionId }: { room: string; sessionId: string }) {
  const players = useQuery(api.players.inRoom, { room }) ?? [];
  const move = useMutation(api.players.move);
  const heartbeat = useMutation(api.players.heartbeat);
  const { camera } = useThree();
  const last = useRef(0);

  useEffect(() => { const t = setInterval(() => heartbeat({ sessionId }), 5000); return () => clearInterval(t); }, [heartbeat, sessionId]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (t - last.current > 1 / SEND_HZ) {
      last.current = t;
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      move({ sessionId, position: camera.position.toArray(), yaw: e.y });
    }
  });

  return (
    <>
      {players.filter((p) => p.sessionId !== sessionId).map((p) => (
        <RemotePlayer key={p._id} target={p.position} yaw={p.yaw} color={p.color} name={p.name} />
      ))}
    </>
  );
}

function RemotePlayer({ target, yaw, color }: { target: number[]; yaw: number; color: string; name: string }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    const g = ref.current; if (!g) return;
    g.position.lerp(new THREE.Vector3(...(target as [number, number, number])), 1 - Math.exp(-8 * dt));
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, yaw, 1 - Math.exp(-8 * dt));
  });
  return (
    <group ref={ref}>
      <mesh position={[0, -0.3, 0]}><capsuleGeometry args={[0.2, 0.6, 4, 8]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0, 0.25, -0.25]}><boxGeometry args={[0.15, 0.1, 0.1]} /><meshStandardMaterial color="white" /></mesh>
    </group>
  );
}
