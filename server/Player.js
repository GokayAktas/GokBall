/**
 * Server-side Player class
 */
export class Player {
    constructor(socket, name) {
        this.id = socket.id;
        this.socket = socket;
        this.name = name || 'Player';
        this.team = 'spectator'; // 'red' | 'blue' | 'spectator'
        this.isAdmin = false;
        this.avatar = '';
        this.input = { up: false, down: false, left: false, right: false, kick: false };
        this.discIndex = -1; // Index in physics.discs
        this.typing = false;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            team: this.team,
            isAdmin: this.isAdmin,
            avatar: this.avatar,
            typing: this.typing
        };
    }
}
