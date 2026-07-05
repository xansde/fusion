import * as React from "react";

export interface SearchBoxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  placeholder?: string;
  style?: React.CSSProperties;
}

/** Search field with leading magnifier glyph and accent focus ring. */
export declare function SearchBox(props: SearchBoxProps): JSX.Element;
