import * as THREE from 'three';

export function createWorld(scene: THREE.Scene) {
    const planeGeometry = new THREE.PlaneGeometry(100, 100);

    const planeMaterial = new THREE.MeshStandardMaterial({
        color: 0x888888,
        side: THREE.DoubleSide
    });

    const plane = new THREE.Mesh(planeGeometry, planeMaterial);

    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -1.5;

    scene.add(plane);

    /* we need to add a light so we can see our cube - its almost
    as if we're turning on a lightbulb within the room */
    const ambientLight = new THREE.AmbientLight(0xFFFF00);
    scene.add(ambientLight);

    const light = new THREE.DirectionalLight(0xFFFF00);
    /* position the light so it shines on the cube (x, y, z) */
    light.position.set(5, 5, 5);
    scene.add(light);
}