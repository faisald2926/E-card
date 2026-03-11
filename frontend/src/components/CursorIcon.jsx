import React from 'react';

const CursorIcon = ({ color = 'white', scale = 1 }) => {
    return (
        <svg
            width="40"
            height="40"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ transform: `scale(${scale})`, filter: 'drop-shadow(2px 2px 0px rgba(0,0,0,0.5))' }}
            shapeRendering="crispEdges"
        >
            {/* Outline */}
            <path
                d="M14 2H10V10H6V22H10V26H22V22H26V10H22V6H18V2H14Z"
                fill="black"
                transform="translate(1, 1)" /* Drop shadow sort of, or border backing */
            />
            {/* Main Fill */}
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M15 3H11V11H7V23H11V27H23V23H27V11H23V7H19V3H15ZM13 5V11H9V21H13V25H21V21H25V13H21V9H17V5H13Z"
                fill={color}
            />
            {/* Better Pointer Shape logic */}
            {/* Let's try a simpler manual path for a 'pointing' hand */}
            <path
                d="M12 0H16V10H18V12H20V14H22V24H14V22H12V20H10V18H8V6H12V0Z"
                fill="black"
                transform="scale(1.1) translate(-1, -1)"
            />
            <path
                d="M12 1H15V10H17V12H19V14H21V23H15V21H13V19H11V17H9V7H12V1Z"
                fill={color}
            />
        </svg>
    );
};

export default CursorIcon;
