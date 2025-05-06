// Types and Interfaces
/**
 * @typedef {Object} Point
 * @property {number} x - X coordinate
 * @property {number} y - Y coordinate
 */

/**
 * @typedef {Object} Line
 * @property {Point} start - Starting point
 * @property {Point} end - Ending point
 */

/**
 * @typedef {Object} Constraints
 * @property {number} bottom - Distance constraint from bottom fixed point
 * @property {number} top - Distance constraint from top fixed point
 */

/**
 * @typedef {Object} CanvasConfig
 * @property {number} scale - Canvas scale factor
 * @property {number} margin - Margin around visible area
 * @property {number} trackingMargin - Extra margin for mouse tracking
 * @property {Object} colors - Color configuration
 * @property {Object} styles - Style configuration
 */

/**
 * @typedef {Object} State
 * @property {Point|null} currentPoint - Current point being moved
 * @property {Point|null} startPoint - Initial point when dragging started
 * @property {Constraints|null} currentConstraints - Current distance constraints
 * @property {boolean} isInteracting - Track if user has started interacting
 */

// Configuration
const CONFIG = {
    canvas: {
        scale: 2,
        margin: 100,
        trackingMargin: 100,
        colors: {
            background: '#ffffff',
            fixedPoint: '#666666',
            startPoint: '#66ff66',
            currentPoint: '#ff6666',
            midpoint: 'pink',
            intersection: 'black',
            constraintCircle: '#666666',
            line: 'black',
            blueLine: 'blue',
            reflection: 'black',
            polygon: 'rgba(58, 58, 58, 0.3)',
            polygonAlt: 'rgb(170, 170, 170)'
        },
        styles: {
            lineWidth: 2,
            pointRadius: 5,
            constraintDash: [5, 5],
            bisectLength: 2000
        },
        image: {
            src: 'img1.png',
            backgroundSrc: 'img2.png'  // Add second image source
        }
    },
    debug: {
        showConstraintCircles: true,
        showRotatedLine: true,
        showFixedPoints: true,
        showIntersectionPoints: true,
        showCurrentPointLines: true,
        showMidpoint: true,
        showGrabbedPoint: true,
        showBisectingLine: true,
        showReflectedPoints: true
    }
};

// Canvas Setup
const canvas = document.getElementById('bezierCanvas');
const ctx = canvas.getContext('2d');

// Load background images
const backgroundImage = new Image();
backgroundImage.src = CONFIG.canvas.image.src;
backgroundImage.onload = () => {
    draw(); // Redraw when image is loaded
};

const backgroundImage2 = new Image();
backgroundImage2.src = CONFIG.canvas.image.backgroundSrc;
backgroundImage2.onload = () => {
    draw(); // Redraw when second image is loaded
};

// Calculate dimensions
const visibleWidth = 2 * ((210 * CONFIG.canvas.scale) + CONFIG.canvas.margin);
const visibleHeight = (297 * CONFIG.canvas.scale) + CONFIG.canvas.margin;

// Set canvas size
canvas.width = visibleWidth + (2 * CONFIG.canvas.trackingMargin);
canvas.height = visibleHeight + (2 * CONFIG.canvas.trackingMargin);

// Calculate offsets
const offsetX = CONFIG.canvas.trackingMargin;
const offsetY = CONFIG.canvas.trackingMargin;

// Fixed points and lines
const fixedPoints = {
    bot: { x: offsetX + visibleWidth / 2, y: offsetY + visibleHeight - 50 },
    top: { x: offsetX + visibleWidth / 2, y: offsetY + 50 }
};

const verticalLine = {
    bot: { x: offsetX + visibleWidth / 2 + 470, y: offsetY + visibleHeight - 50 },
    top: { x: offsetX + visibleWidth / 2 + 470, y: offsetY + 50 }
};

// State management
/** @type {State} */
const state = {
    currentPoint: null,
    startPoint: null,
    currentConstraints: null,
    isInteracting: false
};

// Utility Functions
const utils = {
    distance: (point1, point2) => {
        return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
    },

    isNearLine: (mouseX) => {
        return Math.abs(mouseX - verticalLine.top.x) < 10;
    },

    getMousePos: (canvas, evt) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    },

    calculateMidpoint: (point1, point2) => ({
        x: (point1.x + point2.x) / 2,
        y: (point1.y + point2.y) / 2
    }),

    calculateRelativePosition: (point) => {
        const totalLength = verticalLine.bot.y - verticalLine.top.y;
        const position = point.y - verticalLine.top.y;
        return position / totalLength;
    },

    calculateAngle: (point1, point2) => {
        return Math.atan2(point2.y - point1.y, point2.x - point1.x);
    },

    rotatePoint: (point, origin, angle) => {
        const dx = point.x - origin.x;
        const dy = point.y - origin.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: origin.x + (dx * cos - dy * sin),
            y: origin.y + (dx * sin + dy * cos)
        };
    },

    findIntersection: (line1Start, line1End, line2Start, line2End) => {
        const denominator = ((line2End.y - line2Start.y) * (line1End.x - line1Start.x)) -
                          ((line2End.x - line2Start.x) * (line1End.y - line1Start.y));

        if (denominator === 0) return null;

        const ua = (((line2End.x - line2Start.x) * (line1Start.y - line2Start.y)) -
                   ((line2End.y - line2Start.y) * (line1Start.x - line2Start.x))) / denominator;
        const ub = (((line1End.x - line1Start.x) * (line1Start.y - line2Start.y)) -
                   ((line1End.y - line1Start.y) * (line1Start.x - line2Start.x))) / denominator;

        if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;

        return {
            x: line1Start.x + ua * (line1End.x - line1Start.x),
            y: line1Start.y + ua * (line1End.y - line1Start.y)
        };
    },

    reflectPoint: (point, lineStart, lineEnd) => {
        // Calculate the vector of the line
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        
        // Calculate the squared length of the line
        const lengthSquared = dx * dx + dy * dy;
        
        // Calculate the dot product of the point relative to lineStart and the line vector
        const dot = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;
        
        // Calculate the projection point
        const projX = lineStart.x + dot * dx;
        const projY = lineStart.y + dot * dy;
        
        // Calculate the reflected point
        return {
            x: 2 * projX - point.x,
            y: 2 * projY - point.y
        };
    }
};

// Drawing Functions
const drawing = {
    // Canvas setup and clearing
    clearCanvas: () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    },

    // Add function to draw the background image
    drawBackgroundImage: () => {
        if (backgroundImage2.complete) {
            // Calculate quad dimensions
            const quadWidth = Math.abs(verticalLine.top.x - fixedPoints.top.x);
            const quadHeight = Math.abs(fixedPoints.bot.y - fixedPoints.top.y);
            
            // Calculate scale to fit image within quad while maintaining aspect ratio
            const scaleX = quadWidth / backgroundImage2.width;
            const scaleY = quadHeight / backgroundImage2.height;
            const scale = Math.min(scaleX, scaleY);
            
            // Calculate dimensions
            const imageWidth = backgroundImage2.width * scale;
            const imageHeight = backgroundImage2.height * scale;
            
            // Center the image within the quad
            const x = fixedPoints.top.x + (quadWidth - imageWidth) / 2;
            const y = fixedPoints.top.y + (quadHeight - imageHeight) / 2;
            
            ctx.drawImage(
                backgroundImage2,
                x, y,
                imageWidth,
                imageHeight
            );
        }
    },

    // Add function to draw the full image
    drawFullImage: () => {
        if (backgroundImage.complete && !state.isInteracting) {
            // Calculate quad dimensions
            const quadWidth = Math.abs(verticalLine.top.x - fixedPoints.top.x);
            const quadHeight = Math.abs(fixedPoints.bot.y - fixedPoints.top.y);
            
            // Calculate scale to fit image within quad while maintaining aspect ratio
            const scaleX = quadWidth / backgroundImage.width;
            const scaleY = quadHeight / backgroundImage.height;
            const scale = Math.min(scaleX, scaleY);
            
            // Calculate dimensions
            const imageWidth = backgroundImage.width * scale;
            const imageHeight = backgroundImage.height * scale;
            
            // Center the image within the quad
            const x = fixedPoints.top.x + (quadWidth - imageWidth) / 2;
            const y = fixedPoints.top.y + (quadHeight - imageHeight) / 2;
            
            ctx.drawImage(
                backgroundImage,
                x, y,
                imageWidth,
                imageHeight
            );
        }
    },

    // Basic shape drawing functions
    drawPoint: (point, color) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, CONFIG.canvas.styles.pointRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.stroke();
    },

    drawLine: (start, end, color = CONFIG.canvas.colors.line) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = CONFIG.canvas.styles.lineWidth;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    },

    drawDottedCircle: (x, y, radius) => {
        ctx.beginPath();
        ctx.setLineDash(CONFIG.canvas.styles.constraintDash);
        ctx.strokeStyle = CONFIG.canvas.colors.constraintCircle;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
    },

    drawPolygon: (points, fillStyle, isBasePolygon = false) => {
        if (points.length < 3)  { console.log(points, "what the hell!!! immediate returns"); return; };
        
        let pointsToDraw = [];
        let mod = false;
        for (let i = 0; i < points.length - 1; i++) {
            // if distance between points is less than 3, skip
            if (utils.distance(points[i], points[i + 1]) < 1) {
                continue;
            } else {
                pointsToDraw.push(points[i]);
            }
        }
        pointsToDraw.push(points[points.length - 1]);

        if (mod) {
            console.log(pointsToDraw, "modded points");
            console.log(points, "original points");
        }

        if (points.length < 3)  { console.log(points, "return on filter!!!"); return; };

        ctx.save();
        
        if (isBasePolygon) {
            // For base polygon, use it as a mask for the image
            ctx.beginPath();
            ctx.moveTo(pointsToDraw[0].x, pointsToDraw[0].y);
            for (let i = 1; i < pointsToDraw.length; i++) {
                ctx.lineTo(pointsToDraw[i].x, pointsToDraw[i].y);
            }
            ctx.closePath();
            
            // Use the path as a clipping mask
            ctx.clip();
            
            // Draw the image within the clipped area
            if (backgroundImage.complete) {
                // Calculate quad dimensions
                const quadWidth = Math.abs(verticalLine.top.x - fixedPoints.top.x);
                const quadHeight = Math.abs(fixedPoints.bot.y - fixedPoints.top.y);
                
                // Calculate scale to fit image within quad while maintaining aspect ratio
                const scaleX = quadWidth / backgroundImage.width;
                const scaleY = quadHeight / backgroundImage.height;
                const scale = Math.min(scaleX, scaleY);
                
                // Calculate dimensions
                const imageWidth = backgroundImage.width * scale;
                const imageHeight = backgroundImage.height * scale;
                
                // Center the image within the quad
                const x = fixedPoints.top.x + (quadWidth - imageWidth) / 2;
                const y = fixedPoints.top.y + (quadHeight - imageHeight) / 2;
                
                ctx.drawImage(
                    backgroundImage,
                    x, y,
                    imageWidth,
                    imageHeight
                );
            }
        } else {
            // For reflection polygons, add shadow effect
            ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
            ctx.shadowBlur = 25;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            // Draw the polygon
            ctx.beginPath();
            ctx.moveTo(pointsToDraw[0].x, pointsToDraw[0].y);
            for (let i = 1; i < pointsToDraw.length; i++) {
                ctx.lineTo(pointsToDraw[i].x, pointsToDraw[i].y);
            }
            ctx.closePath();
            ctx.fillStyle = fillStyle;
            ctx.fill();
        }
        
        ctx.restore();
    },

    // Scene element drawing functions
    drawVerticalLine: () => {
        drawing.drawLine(verticalLine.top, verticalLine.bot);
    },

    drawFixedLines: () => {
        drawing.drawLine(fixedPoints.top, verticalLine.top);
        drawing.drawLine(fixedPoints.bot, verticalLine.bot);
    },

    drawConstraintCircles: () => {
        if (!state.currentPoint || !state.currentConstraints || !CONFIG.debug.showConstraintCircles) return;
        
        drawing.drawDottedCircle(fixedPoints.bot.x, fixedPoints.bot.y, state.currentConstraints.bottom);
        drawing.drawDottedCircle(fixedPoints.top.x, fixedPoints.top.y, state.currentConstraints.top);
    },

    drawCurrentPointLines: () => {
        if (!state.currentPoint || !CONFIG.debug.showCurrentPointLines) return;

        drawing.drawLine(fixedPoints.bot, state.currentPoint, CONFIG.canvas.colors.blueLine);
        drawing.drawLine(fixedPoints.top, state.currentPoint, CONFIG.canvas.colors.blueLine);
    },

    drawFixedPoints: () => {
        if (!CONFIG.debug.showFixedPoints) return;
        
        Object.values(fixedPoints).forEach(point => {
            drawing.drawPoint(point, CONFIG.canvas.colors.fixedPoint);
        });
    },

    drawStatePoints: () => {
        // Removed start point and grabbed point visualization
    },

    // Complex geometric drawing functions
    drawMidpointAndLines: () => {
        if (!state.startPoint || !state.currentPoint) return;

        // Calculate and draw midpoint
        const midpoint = utils.calculateMidpoint(state.startPoint, state.currentPoint);
        if (CONFIG.debug.showMidpoint) {
            drawing.drawPoint(midpoint, CONFIG.canvas.colors.midpoint);
        }

        // Calculate angles and positions for geometric constructions
        const angle = utils.calculateAngle(state.startPoint, state.currentPoint);
        const bisectAngle = angle + Math.PI/2;  // Perpendicular to the line between points
        const relativePosition = utils.calculateRelativePosition(state.startPoint);
        const lineLength = visibleHeight - 2 * 50;

        // Calculate points for the rotated line
        const lineY1 = state.currentPoint.y - (lineLength * (1-relativePosition));
        const lineY2 = state.currentPoint.y + (lineLength * relativePosition);

        const linePoint1 = { x: state.currentPoint.x, y: lineY1 };
        const linePoint2 = { x: state.currentPoint.x, y: lineY2 };

        // Rotate the line points around the current points
        const rotatedPoint1 = utils.rotatePoint(linePoint1, state.currentPoint, angle);
        const rotatedPoint2 = utils.rotatePoint(linePoint2, state.currentPoint, angle);

        // Draw the rotated line only if debug option is enabled
        if (CONFIG.debug.showRotatedLine) {
            drawing.drawLine(rotatedPoint1, rotatedPoint2);
        }

        // Calculate and draw the bisecting line
        const bisectStart = {
            x: midpoint.x - Math.cos(bisectAngle) * CONFIG.canvas.styles.bisectLength/2,
            y: midpoint.y - Math.sin(bisectAngle) * CONFIG.canvas.styles.bisectLength/2
        };
        const bisectEnd = {
            x: midpoint.x + Math.cos(bisectAngle) * CONFIG.canvas.styles.bisectLength/2,
            y: midpoint.y + Math.sin(bisectAngle) * CONFIG.canvas.styles.bisectLength/2
        };

        if (CONFIG.debug.showBisectingLine) {
            drawing.drawLine(bisectStart, bisectEnd);
        }

        // Calculate intersections
        const verticalIntersection = utils.findIntersection(
            bisectStart,
            bisectEnd,
            verticalLine.top,
            verticalLine.bot
        );

        const topFixedIntersection = utils.findIntersection(
            bisectStart,
            bisectEnd,
            { x: fixedPoints.top.x - 0.005, y: fixedPoints.top.y },
            verticalLine.top
        );

        const botFixedIntersection = utils.findIntersection(
            bisectStart,
            bisectEnd,
            { x: fixedPoints.bot.x - 0.005, y: fixedPoints.bot.y },
            verticalLine.bot
        );

        // Draw intersection points only if debug option is enabled
        if (CONFIG.debug.showIntersectionPoints) {
            if (verticalIntersection) {
                drawing.drawPoint(verticalIntersection, CONFIG.canvas.colors.intersection);
            }
            if (topFixedIntersection) {
                drawing.drawPoint(topFixedIntersection, CONFIG.canvas.colors.intersection);
            }
            if (botFixedIntersection) {
                drawing.drawPoint(botFixedIntersection, CONFIG.canvas.colors.intersection);
            }
        }

        // Draw polygons and reflections based on intersection points
        if (topFixedIntersection) {
            if (verticalIntersection) {
                // Draw base polygon as image mask
                drawing.drawPolygon([
                    fixedPoints.top,
                    topFixedIntersection,
                    verticalIntersection,
                    verticalLine.bot,
                    fixedPoints.bot
                ], CONFIG.canvas.colors.polygon, true);
                // Draw reflection and reflected polygon
                const reflectedTop = utils.reflectPoint(verticalLine.top, bisectStart, bisectEnd);
                if (CONFIG.debug.showReflectedPoints) {
                    drawing.drawPoint(reflectedTop, CONFIG.canvas.colors.reflection);
                }
                drawing.drawPolygon([
                    topFixedIntersection,
                    verticalIntersection,
                    reflectedTop
                ], CONFIG.canvas.colors.polygonAlt);
            } else if (botFixedIntersection) {
                // Draw base polygon as image mask
                drawing.drawPolygon([
                    fixedPoints.top,
                    topFixedIntersection,
                    botFixedIntersection,
                    fixedPoints.bot
                ], CONFIG.canvas.colors.polygon, true);

                // Draw reflections and reflected polygon
                const reflectedTop = utils.reflectPoint(verticalLine.top, bisectStart, bisectEnd);
                const reflectedBot = utils.reflectPoint(verticalLine.bot, bisectStart, bisectEnd);
                if (CONFIG.debug.showReflectedPoints) {
                    drawing.drawPoint(reflectedTop, CONFIG.canvas.colors.reflection);
                    drawing.drawPoint(reflectedBot, CONFIG.canvas.colors.reflection);
                }
                drawing.drawPolygon([
                    topFixedIntersection,
                    botFixedIntersection,
                    reflectedBot,
                    reflectedTop
                ], CONFIG.canvas.colors.polygonAlt);
            }
        } else if (botFixedIntersection) {
            if (verticalIntersection) {
                // Draw base polygon as image mask
                drawing.drawPolygon([
                    fixedPoints.top,
                    verticalLine.top,
                    verticalIntersection,
                    botFixedIntersection,
                    fixedPoints.bot
                ], CONFIG.canvas.colors.polygon, true);

                // Draw reflection and reflected polygon
                const reflectedBot = utils.reflectPoint(verticalLine.bot, bisectStart, bisectEnd);
                if (CONFIG.debug.showReflectedPoints) {
                    drawing.drawPoint(reflectedBot, CONFIG.canvas.colors.reflection);
                }
                drawing.drawPolygon([
                    botFixedIntersection,
                    verticalIntersection,
                    reflectedBot
                ], CONFIG.canvas.colors.polygonAlt);
            }
        }
    },

    // Add function to draw the background quad
    drawBackgroundQuad: () => {
        ctx.save();
        
        // Set up shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 25;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        
        // Draw the quad
        ctx.beginPath();
        ctx.moveTo(fixedPoints.top.x, fixedPoints.top.y);
        ctx.lineTo(verticalLine.top.x, verticalLine.top.y);
        ctx.lineTo(verticalLine.bot.x, verticalLine.bot.y);
        ctx.lineTo(fixedPoints.bot.x, fixedPoints.bot.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(200, 200, 200, 0.5)';
        ctx.fill();
        
        ctx.restore();
    }
};

// State Management Functions
const stateManager = {
    calculateConstraints: (point) => ({
        bottom: utils.distance(fixedPoints.bot, point),
        top: utils.distance(fixedPoints.top, point)
    }),

    updatePoint: (targetX, targetY) => {
        if (!state.currentPoint || !state.currentConstraints) return;

        let newX = targetX;
        let newY = targetY;
        
        // Apply bottom constraint
        const distToStart = utils.distance(fixedPoints.bot, { x: newX, y: newY });
        if (distToStart > state.currentConstraints.bottom) {
            const angle = Math.atan2(newY - fixedPoints.bot.y, newX - fixedPoints.bot.x);
            newX = fixedPoints.bot.x + state.currentConstraints.bottom * Math.cos(angle);
            newY = fixedPoints.bot.y + state.currentConstraints.bottom * Math.sin(angle);
        }
        
        // Apply top constraint
        const distToTop = utils.distance(fixedPoints.top, { x: newX, y: newY });
        if (distToTop > state.currentConstraints.top) {
            const angle = Math.atan2(newY - fixedPoints.top.y, newX - fixedPoints.top.x);
            newX = fixedPoints.top.x + state.currentConstraints.top * Math.cos(angle);
            newY = fixedPoints.top.y + state.currentConstraints.top * Math.sin(angle);
        }
        
        state.currentPoint.x = newX;
        state.currentPoint.y = newY;
    },

    resetState: () => {
        state.currentPoint = null;
        state.startPoint = null;
        state.currentConstraints = null;
        state.isInteracting = false;
    },

    initializePoint: (x, y) => {
        state.currentPoint = { x, y };
        state.startPoint = { x, y };
        state.currentConstraints = stateManager.calculateConstraints(state.currentPoint);
        state.isInteracting = true;
    }
};

// Event Handlers
const eventHandlers = {
    onMouseDown: (e) => {
        const mousePos = utils.getMousePos(canvas, e);
        if (utils.isNearLine(mousePos.x)) {
            stateManager.initializePoint(verticalLine.top.x, mousePos.y);
        }
    },

    onMouseMove: (e) => {
        if (state.currentPoint) {
            const mousePos = utils.getMousePos(canvas, e);
            stateManager.updatePoint(mousePos.x, mousePos.y);
            draw();
        }
    },

    onMouseUp: () => {
        stateManager.resetState();
        draw();
    },

    onMouseLeave: () => {
        stateManager.resetState();
        draw();
    }
};

// Initialize event listeners
canvas.addEventListener('mousedown', eventHandlers.onMouseDown);
canvas.addEventListener('mousemove', eventHandlers.onMouseMove);
canvas.addEventListener('mouseup', eventHandlers.onMouseUp);
canvas.addEventListener('mouseleave', eventHandlers.onMouseLeave);

// Main draw function
function draw() {
    drawing.clearCanvas();
    drawing.drawBackgroundQuad();   // Draw background quad first
    drawing.drawBackgroundImage();  // Then draw background image
    drawing.drawVerticalLine();
    drawing.drawFixedLines();
    drawing.drawConstraintCircles();
    drawing.drawCurrentPointLines();
    drawing.drawFixedPoints();
    drawing.drawStatePoints();
    drawing.drawMidpointAndLines();
    drawing.drawFullImage();  // Draw foreground image last
}

// Initial draw
draw(); 