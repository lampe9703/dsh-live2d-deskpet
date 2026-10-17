/** Small presentational primitives shared by the section's five blocks. */
import { type ReactNode } from 'react';
export interface CardProps {
    title: string;
    actions?: ReactNode;
    children?: ReactNode;
}
/** A titled card, the section's one layout primitive. */
export declare function Card(props: CardProps): ReactNode;
/** One labelled control row. */
export declare function Field(props: {
    label: string;
    hint?: string;
    children?: ReactNode;
}): ReactNode;
/**
 * The harness-styled toggle used for every boolean in the section.
 *
 * The knob's travel is a `left` transition (see {@link styles.switchKnob} plus
 * the `.deskpet-switch-knob` rule in `SECTION_CSS`), so the slide only plays
 * when `checked` actually changes — a write that never updates the committed
 * section leaves the knob parked, which is exactly what a silently refused
 * write looked like.
 */
export declare function Switch(props: {
    checked: boolean;
    label?: string;
    disabled?: boolean;
    onToggle: () => void;
}): ReactNode;
/** A segmented three-way (or N-way) chooser. */
export declare function Segmented<T extends string>(props: {
    value: T;
    options: ReadonlyArray<{
        value: T;
        label: string;
    }>;
    onChange: (value: T) => void;
}): ReactNode;
/** A text input bound to a string field. */
export declare function TextInput(props: {
    value: string;
    placeholder?: string;
    type?: string;
    style?: Record<string, unknown>;
    onChange: (value: string) => void;
}): ReactNode;
/** A multiline input bound to a string field. */
export declare function TextArea(props: {
    value: string;
    placeholder?: string;
    minHeight?: string;
    onChange: (value: string) => void;
}): ReactNode;
/** A label/value line used for read-only runtime facts. */
export declare function Fact(props: {
    label: string;
    value: ReactNode;
    mono?: boolean;
}): ReactNode;
export interface StatusProps {
    tone: 'ok' | 'fail' | 'hint';
    children?: ReactNode;
}
/** Inline failure/success line. */
export declare function Status(props: StatusProps): ReactNode;
//# sourceMappingURL=primitives.d.ts.map