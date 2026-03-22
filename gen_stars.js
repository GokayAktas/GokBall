
const innerR = 75;
const starR = 15;
const angles = [0, 45, 90, 135, 180, 225, 270, 315];
const vertexes = [];
const segments = [];

let startIdx = 14;
for (let a of angles) {
    const rad = a * Math.PI / 180;
    const cx = innerR * Math.cos(rad);
    const cy = innerR * Math.sin(rad);
    
    const starPoints = [];
    for (let i = 0; i < 5; i++) {
        const pRad = rad + (i * 144) * Math.PI / 180;
        const px = cx + starR * Math.cos(pRad);
        const py = cy + starR * Math.sin(pRad);
        vertexes.push(`{ x: ${px.toFixed(1)}, y: ${py.toFixed(1)}, cMask: [], cGroup: [] }`);
        starPoints.push(startIdx + i);
    }
    
    segments.push(`{ v0: ${starPoints[0]}, v1: ${starPoints[1]}, vis: true, color: "666666", bCoef: 0 }`);
    segments.push(`{ v0: ${starPoints[1]}, v1: ${starPoints[2]}, vis: true, color: "666666", bCoef: 0 }`);
    segments.push(`{ v0: ${starPoints[2]}, v1: ${starPoints[3]}, vis: true, color: "666666", bCoef: 0 }`);
    segments.push(`{ v0: ${starPoints[3]}, v1: ${starPoints[4]}, vis: true, color: "666666", bCoef: 0 }`);
    segments.push(`{ v0: ${starPoints[4]}, v1: ${starPoints[0]}, vis: true, color: "666666", bCoef: 0 }`);
    
    startIdx += 5;
}

console.log("Vertexes:");
console.log(vertexes.join(",\n"));
console.log("\nSegments:");
console.log(segments.join(",\n"));
