use tiny_skia::*;
mod layout {
    include!("../assets/layout.rs");
}

pub const KEYS: [u16; 7] = [65, 87, 83, 68, 160, 162, 32];
pub const W: f32 = 1536.0;
pub const H: f32 = 1024.0;
pub type V = [f32; 2];
#[derive(Clone, Copy)]
pub struct Arm {
    shoulder: V,
    elbow: V,
    wrist: V,
    home: V,
    offset: V,
    scale: f32,
    shift: V,
}
pub const MOUSE: Arm = Arm {
    shoulder: [635., 350.],
    elbow: [555., 450.],
    wrist: [455., 515.],
    home: [455., 515.],
    offset: [0., 0.],
    scale: 1.,
    shift: [-20., 0.],
};
pub const KEYBOARD: Arm = Arm {
    shoulder: [1075., 325.],
    elbow: [1190., 465.],
    wrist: [1040., 615.],
    home: [1080., 565.],
    offset: [228.5, 98.5],
    scale: 0.82,
    shift: [-24., 0.],
};

pub fn key_points(vk: u16) -> Option<[[f32; 2]; 4]> {
    Some(match vk {
        32 => [[868., 589.], [1168., 629.], [1164., 666.], [849., 629.]],
        162 => [[1196., 639.], [1289., 655.], [1282., 692.], [1183., 677.]],
        68 => [[838., 645.], [924., 658.], [919., 694.], [818., 683.]],
        83 => [[956., 663.], [1036., 677.], [1032., 718.], [937., 703.]],
        65 => [[1069., 682.], [1156., 694.], [1146., 734.], [1052., 720.]],
        160 => [[1184., 701.], [1282., 716.], [1273., 758.], [1169., 744.]],
        87 => [[958., 729.], [1047., 745.], [1036., 786.], [946., 769.]],
        _ => return None,
    })
}
pub fn key_target(vk: Option<u16>) -> V {
    match vk.and_then(key_points) {
        Some(p) => [
            p.iter().map(|v| v[0]).sum::<f32>() / 4.,
            p.iter().map(|v| v[1]).sum::<f32>() / 4. - 65.,
        ],
        None => KEYBOARD.home,
    }
}
pub fn mouse_target(cursor: V, pressed: bool) -> V {
    let mut c = [
        448. - cursor[0] * 100.,
        730. - cursor[1] * 44. + if pressed { 5. } else { 0. },
    ];
    let pad = [[300., 523.], [715., 582.], [550., 819.], [105., 742.]];
    for _ in 0..6 {
        for i in 0..4 {
            let a = pad[i];
            let b = pad[(i + 1) % 4];
            let length = f32::hypot(b[0] - a[0], b[1] - a[1]);
            let n = [(a[1] - b[1]) / length, (b[0] - a[0]) / length];
            let missing = f32::hypot(n[0] * 92., n[1] * 27.) + 4.
                - ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1]);
            if missing > 0. {
                c[0] += n[0] * missing;
                c[1] += n[1] * missing;
            }
        }
    }
    [c[0] + 7., c[1] - 215.]
}

#[derive(Default)]
pub struct Input {
    pub keys: Vec<u16>,
    pub buttons: [bool; 2],
    pub cursor: V,
}
impl Input {
    pub fn key(&mut self, vk: u16, down: bool) -> bool {
        if !KEYS.contains(&vk) || self.keys.contains(&vk) == down {
            return false;
        }
        if down {
            self.keys.push(vk);
        } else {
            self.keys.retain(|&k| k != vk);
        }
        true
    }
}

pub struct Rig {
    base: Layer,
    mouse: Layer,
    mouse_arm: Layer,
    keyboard_arm: Layer,
    cover: Layer,
    accessory: Option<(u8, Layer)>,
    pub canvas: Pixmap,
    arm_buffer: Pixmap,
    mouse_pose: V,
    key_pose: V,
    eyes: V,
}
struct Layer {
    image: Pixmap,
    offset: V,
}
fn png(bytes: &[u8], offset: V) -> Layer {
    Layer {
        image: Pixmap::decode_png(bytes).expect("embedded pet PNG"),
        offset,
    }
}
impl Rig {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            base: png(include_bytes!("../assets/base.png"), layout::BASE),
            mouse: png(include_bytes!("../assets/mouse.png"), layout::MOUSE),
            mouse_arm: png(include_bytes!("../assets/mouse-arm.png"), layout::MOUSE_ARM),
            keyboard_arm: png(
                include_bytes!("../assets/keyboard-arm.png"),
                layout::KEYBOARD_ARM,
            ),
            cover: png(
                include_bytes!("../assets/shoulder-cover.png"),
                layout::SHOULDER_COVER,
            ),
            accessory: None,
            canvas: Pixmap::new(width, height).unwrap(),
            arm_buffer: Pixmap::new(width, height).unwrap(),
            mouse_pose: MOUSE.home,
            key_pose: KEYBOARD.home,
            eyes: [0., 0.],
        }
    }
    pub fn resize(&mut self, w: u32, h: u32) {
        if self.canvas.width() != w || self.canvas.height() != h {
            self.canvas = Pixmap::new(w, h).unwrap();
            self.arm_buffer = Pixmap::new(w, h).unwrap();
        }
    }
    pub fn accessory(&mut self, id: u8) {
        if self.accessory.as_ref().map(|a| a.0).unwrap_or(0) == id {
            return;
        }
        self.accessory = match id {
            1 => Some((
                id,
                png(include_bytes!("../assets/eye-patch.png"), layout::EYE_PATCH),
            )),
            2 => Some((
                id,
                png(include_bytes!("../assets/angry.png"), layout::ANGRY),
            )),
            3 => Some((id, png(include_bytes!("../assets/meow.png"), layout::MEOW))),
            _ => None,
        };
    }
    pub fn step(&mut self, input: &Input, dt: f32) -> bool {
        let targets = [
            mouse_target(input.cursor, input.buttons.iter().any(|&v| v)),
            key_target(input.keys.last().copied()),
            [input.cursor[0] * 8., input.cursor[1] * 6.],
        ];
        let alpha = 1. - (-dt.clamp(1., 50.) / 55.).exp();
        let mut moving = false;
        for (pose, target) in [&mut self.mouse_pose, &mut self.key_pose, &mut self.eyes]
            .into_iter()
            .zip(targets)
        {
            for i in 0..2 {
                let delta = target[i] - pose[i];
                if delta.abs() > 0.04 {
                    moving = true;
                    pose[i] += delta * alpha;
                } else {
                    pose[i] = target[i];
                }
            }
        }
        moving
    }
    pub fn draw(&mut self, input: &Input) {
        let s = self.canvas.width() as f32 / W;
        let world = Transform::from_scale(s, s);
        self.canvas.fill(Color::TRANSPARENT);
        blit(&mut self.canvas, &self.base, world);
        for (x, y, rx, ry) in [(758., 165., 20., 22.), (945., 190., 21., 23.)] {
            ellipse(
                &mut self.canvas,
                x + self.eyes[0],
                y + self.eyes[1],
                rx,
                ry,
                Color::from_rgba8(16, 24, 14, 255),
                world,
            );
            ellipse(
                &mut self.canvas,
                x + self.eyes[0] - 6.,
                y + self.eyes[1] - 8.,
                4.,
                3.,
                Color::from_rgba8(255, 255, 235, 82),
                world,
            );
        }
        for vk in &input.keys {
            if let Some(points) = key_points(*vk) {
                let mut p = PathBuilder::new();
                p.move_to(points[0][0], points[0][1] + 2.);
                for v in &points[1..] {
                    p.line_to(v[0], v[1] + 2.);
                }
                p.close();
                let p = p.finish().unwrap();
                let mut paint = Paint::default();
                paint.set_color_rgba8(255, 174, 34, 87);
                self.canvas
                    .fill_path(&p, &paint, FillRule::Winding, world, None);
                paint.set_color_rgba8(255, 244, 174, 242);
                self.canvas.stroke_path(
                    &p,
                    &paint,
                    &Stroke {
                        width: 3.,
                        ..Stroke::default()
                    },
                    world,
                    None,
                );
            }
        }
        blit(
            &mut self.canvas,
            &self.mouse,
            Transform::from_row(
                0.876,
                0.,
                0.,
                0.924,
                self.mouse_pose[0] - MOUSE.home[0] - 19.,
                self.mouse_pose[1] - MOUSE.home[1] + 34.,
            )
            .post_concat(world),
        );
        paint_arm(
            &mut self.canvas,
            &mut self.arm_buffer,
            &self.mouse_arm,
            MOUSE,
            self.mouse_pose,
        );
        paint_arm(
            &mut self.canvas,
            &mut self.arm_buffer,
            &self.keyboard_arm,
            KEYBOARD,
            self.key_pose,
        );
        blit(&mut self.canvas, &self.cover, world);
        if let Some((_, image)) = &self.accessory {
            blit(
                &mut self.canvas,
                image,
                Transform::from_row(1.26, 0.088, 0., 1., -184., -98.).post_concat(world),
            );
        }
    }
    pub fn draw_video(&mut self, image: &Pixmap) {
        self.canvas.fill(Color::TRANSPARENT);
        let s = (self.canvas.width() as f32 / image.width() as f32)
            .min(self.canvas.height() as f32 / image.height() as f32);
        let t = Transform::from_row(
            s,
            0.,
            0.,
            s,
            (self.canvas.width() as f32 - image.width() as f32 * s) / 2.,
            (self.canvas.height() as f32 - image.height() as f32 * s) / 2.,
        );
        self.canvas.draw_pixmap(
            0,
            0,
            image.as_ref(),
            &PixmapPaint {
                quality: FilterQuality::Bilinear,
                ..PixmapPaint::default()
            },
            t,
            None,
        );
    }
}
fn blit(dst: &mut Pixmap, src: &Layer, transform: Transform) {
    let t =
        Transform::from_row(1.6, 0., 0., 1.6, src.offset[0], src.offset[1]).post_concat(transform);
    dst.draw_pixmap(
        0,
        0,
        src.image.as_ref(),
        &PixmapPaint {
            quality: FilterQuality::Bilinear,
            ..PixmapPaint::default()
        },
        t,
        None,
    );
}
fn ellipse(dst: &mut Pixmap, x: f32, y: f32, rx: f32, ry: f32, color: Color, t: Transform) {
    let path =
        PathBuilder::from_oval(Rect::from_xywh(x - rx, y - ry, rx * 2., ry * 2.).unwrap()).unwrap();
    let mut paint = Paint::default();
    paint.set_color(color);
    dst.fill_path(&path, &paint, FillRule::Winding, t, None);
}
fn paint_arm(dst: &mut Pixmap, layer: &mut Pixmap, image: &Layer, arm: Arm, target: V) {
    layer.fill(Color::TRANSPARENT);
    let wrist = [
        (target[0] - arm.offset[0]) / arm.scale,
        (target[1] - arm.offset[1]) / arm.scale,
    ];
    let shoulder = [
        arm.shoulder[0] + arm.shift[0],
        arm.shoulder[1] + arm.shift[1],
    ];
    let elbow = [
        arm.elbow[0] + arm.shift[0] * 0.55 + (wrist[0] - arm.wrist[0]) * 0.45,
        arm.elbow[1] + arm.shift[1] * 0.55 + (wrist[1] - arm.wrist[1]) * 0.45,
    ];
    let warp = |y: f32| {
        let (a, b, c, d) = if y < arm.elbow[1] {
            (arm.shoulder, arm.elbow, shoulder, elbow)
        } else {
            (arm.elbow, arm.wrist, elbow, wrist)
        };
        let t = ((y - a[1]) / (b[1] - a[1])).clamp(0., 1.);
        let t = t * t * (3. - 2. * t);
        [
            (c[0] - a[0]) * (1. - t) + (d[0] - b[0]) * t,
            y + (c[1] - a[1]) * (1. - t) + (d[1] - b[1]) * t,
        ]
    };
    let mut rows = vec![0., arm.shoulder[1]];
    let mut y = arm.shoulder[1] + 12.;
    while y < arm.wrist[1] {
        rows.push(y);
        y += 12.;
    }
    rows.extend([arm.wrist[1], H]);
    let s = dst.width() as f32 / W;
    for row in rows.windows(2) {
        let (y0, y1) = (row[0], row[1]);
        let top = warp(y0);
        let bottom = warp(y1);
        let shear = (bottom[0] - top[0]) / (y1 - y0);
        let stretch = (bottom[1] - top[1]) / (y1 - y0);
        let source_height = (H - y0).min(y1 - y0 + (H / dst.height() as f32 * 1.5).max(0.8));
        let clipped_top = y0.max(image.offset[1]);
        let clipped_bottom =
            (y0 + source_height).min(image.offset[1] + image.image.height() as f32 * 1.6);
        if clipped_bottom <= clipped_top {
            continue;
        }
        let t = Transform::from_row(
            arm.scale,
            0.,
            shear * arm.scale,
            stretch * arm.scale,
            (top[0] - shear * y0) * arm.scale + arm.offset[0],
            (top[1] - stretch * y0) * arm.scale + arm.offset[1],
        )
        .post_scale(s, s);
        let paint = Paint {
            shader: Pattern::new(
                image.image.as_ref(),
                SpreadMode::Pad,
                FilterQuality::Bilinear,
                1.,
                Transform::from_row(1.6, 0., 0., 1.6, image.offset[0], image.offset[1]),
            ),
            anti_alias: false,
            ..Paint::default()
        };
        layer.fill_rect(
            Rect::from_xywh(
                image.offset[0],
                clipped_top,
                image.image.width() as f32 * 1.6,
                clipped_bottom - clipped_top,
            )
            .unwrap(),
            &paint,
            t,
            None,
        );
    }
    dst.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &PixmapPaint::default(),
        Transform::identity(),
        None,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn held_keys_and_axes() {
        let mut i = Input::default();
        assert!(!i.key(161, true));
        assert!(i.key(87, true));
        assert!(!i.key(87, true));
        i.key(32, true);
        i.key(160, true);
        i.key(32, false);
        assert_eq!(i.keys, vec![87, 160]);
        assert!(key_target(Some(32))[1] < key_target(Some(87))[1]);
        assert!(mouse_target([1., 1.], false)[0] < mouse_target([-1., -1.], false)[0]);
        assert!(mouse_target([1., 1.], false)[1] < mouse_target([-1., -1.], false)[1]);
    }
    #[test]
    fn geometry_matches_javascript() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../tests/rig-fixtures.json")).unwrap();
        for row in cases.as_array().unwrap() {
            let actual = if row["kind"] == "key" {
                key_target(Some(row["vk"].as_u64().unwrap() as u16))
            } else {
                mouse_target(
                    [
                        row["x"].as_f64().unwrap() as f32,
                        row["y"].as_f64().unwrap() as f32,
                    ],
                    row["pressed"].as_bool().unwrap(),
                )
            };
            for (k, value) in actual.iter().enumerate() {
                assert!((value - row["target"][k].as_f64().unwrap() as f32).abs() < 0.001);
            }
        }
    }
}
